import { respond, ApiError } from "../lib/response.ts";
import { notifySnapshot, readNotifySettings } from "./settings.ts";
import {
  command,
  ipc,
  notifyContext,
  notifySettingsContext,
  type NotifyContext,
  type NotifyOptions,
  type NotifyState,
} from "./context.ts";

/** Query the bus daemon directly: probing must never activate a competing provider. */
async function owner(context: NotifyContext) {
  const busctl = Bun.which("busctl", { PATH: context.env.PATH });
  if (!busctl)
    throw new ApiError("COMMAND_FAILED", "Install busctl to check notification ownership");
  const child = Bun.spawn(
    [
      busctl,
      "--user",
      "call",
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "GetConnectionUnixProcessID",
      "s",
      "org.freedesktop.Notifications",
    ],
    {
      env: { ...context.env, LC_ALL: "C" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 3000,
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    if (
      stderr.includes("does not exist") ||
      stderr.includes("has no owner") ||
      stderr.includes("no such name")
    )
      return null;
    throw new ApiError("COMMAND_FAILED", `Cannot inspect notification bus: ${stderr.trim()}`);
  }
  const match = /^u (\d+)\s*$/.exec(stdout);
  if (!match) throw new ApiError("COMMAND_FAILED", "Invalid notification bus ownership response");
  return Number(match[1]);
}

async function instance(context: NotifyContext) {
  const result = await ipc(context, "pid", true);
  return result.code === 0 && /^\d+$/.test(result.stdout) ? Number(result.stdout) : null;
}

async function running(context: NotifyContext) {
  const pid = await instance(context);
  return pid !== null && pid === (await owner(context));
}

async function start(
  context: NotifyContext,
  prepared?: Awaited<ReturnType<typeof notifySnapshot>>,
) {
  const pid = await instance(context);
  const provider = await owner(context);
  if (pid !== null && pid === provider) return;
  if (provider !== null || pid !== null)
    throw new ApiError(
      "CONFLICT",
      "Another notification provider is active. Stop it before starting Luna notifications.",
    );
  const snapshot = prepared ?? (await notifySnapshot(context));
  context.env.LUNA_NOTIFY_THEME = JSON.stringify(snapshot.theme);
  context.env.LUNA_NOTIFY_SETTINGS = JSON.stringify(snapshot.settings);
  await command(context, [
    "--no-color",
    "--daemonize",
    "--no-duplicate",
    "-p",
    context.shellDirectory,
  ]);
  try {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await running(context)) return;
      await Bun.sleep(50);
    }
    throw new ApiError(
      "COMMAND_FAILED",
      "Notifications did not acquire the session bus; inspect the Quickshell log",
    );
  } catch (error) {
    await command(context, ["kill", "-p", context.shellDirectory], true);
    throw error;
  }
}

async function operate(
  action: "status" | "start" | "stop" | "restart" | "focus" | "dismiss",
  options: NotifyOptions,
) {
  const context = await notifyContext(options);
  // Invalid source settings must not tear down a healthy notification provider.
  const prepared = action === "restart" ? await notifySnapshot(context) : undefined;
  if ((action === "stop" || action === "restart") && (await instance(context)) !== null)
    await command(context, ["kill", "-p", context.shellDirectory]);
  if (action === "start" || action === "restart") await start(context, prepared);
  if ((action === "focus" || action === "dismiss") && (await running(context)))
    await ipc(context, action);
  return {
    running: await running(context),
    shellDirectory: context.shellDirectory,
    configFile: context.configFile,
  } satisfies NotifyState;
}

/** A standalone toast provider. Start requires exclusive notification ownership; focus never steals focus implicitly. */
export const notify = {
  get(key?: string, options: NotifyOptions = {}) {
    return respond(async () => {
      let value: unknown = await readNotifySettings(notifySettingsContext(options));
      if (key === undefined) return value;
      if (!key || key.split(".").some((part) => !part))
        throw new ApiError(
          "INVALID_ARGUMENT",
          "Notification keys use nonempty dot-separated segments",
        );
      for (const part of key.split(".")) {
        if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return null;
        value = (value as Record<string, unknown>)[part];
      }
      return value;
    });
  },
  getConfigFile: (options: NotifyOptions = {}) =>
    respond(() => notifySettingsContext(options).configFile),
  status: (options: NotifyOptions = {}) => respond(() => operate("status", options)),
  start: (options: NotifyOptions = {}) => respond(() => operate("start", options)),
  stop: (options: NotifyOptions = {}) => respond(() => operate("stop", options)),
  restart: (options: NotifyOptions = {}) => respond(() => operate("restart", options)),
  focus: (options: NotifyOptions = {}) => respond(() => operate("focus", options)),
  dismiss: (options: NotifyOptions = {}) => respond(() => operate("dismiss", options)),
};
