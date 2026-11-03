import { metadata } from "../lib/files.ts";
import { ApiError } from "../lib/response.ts";
import { currentTheme } from "../theme/selection.ts";
import { themeContext } from "../theme/context.ts";
import { lockSettingsSchema, type LockSettings } from "./schema.ts";
import type { LockRenderer, LockState } from "./context.ts";

async function execute(context: LockRenderer, args: string[], allowFailure = false) {
  const child = Bun.spawn(args, {
    env: context.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 && !allowFailure)
    throw new ApiError(
      "COMMAND_FAILED",
      `Lock command failed (${code}): ${(stderr || stdout).trim()}`,
    );
  return { code, stdout: stdout.trim() };
}
export function command(context: LockRenderer, args: string[], allowFailure = false) {
  return execute(context, [context.executable, ...args], allowFailure);
}
export function ipc(
  context: LockRenderer,
  method: string,
  args: string[] = [],
  allowFailure = false,
) {
  return command(
    context,
    ["ipc", "-p", context.shellDirectory, "call", "--", "lock", method, ...args],
    allowFailure,
  );
}
export async function state(context: LockRenderer): Promise<LockState> {
  const response = await ipc(context, "status", [], true);
  const status = response.code !== 0 ? "stopped" : response.stdout;
  if (!["stopped", "idle", "locking", "locked"].includes(status))
    throw new ApiError("COMMAND_FAILED", `Unexpected lock status: ${status}`);
  return {
    running: status !== "stopped",
    status: status as LockState["status"],
    shellDirectory: context.shellDirectory,
    configFile: context.configFile,
  };
}
export function themeSnapshot(context: LockRenderer) {
  return currentTheme(themeContext({ env: context.env }));
}
export async function start(context: LockRenderer, settings: LockSettings) {
  if (!context.launcher || !(await metadata(context.launcher))?.isFile())
    throw new ApiError("INVALID_PATH", "Build/install the Luna CLI or supply a lock launcher");
  const args = [context.launcher, "lock", "--config", context.configFile];
  if (context.repository) args.push("--install-dir", context.repository);
  const env = {
    ...context.env,
    LUNA_LOCK_SETTINGS: JSON.stringify(settings),
    LUNA_LOCK_THEME: JSON.stringify(await themeSnapshot(context)),
    LUNA_LOCK_COMMAND: JSON.stringify(args),
  };
  await command({ ...context, env }, [
    "--no-color",
    "--daemonize",
    "--no-duplicate",
    "-p",
    context.shellDirectory,
  ]);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const current = await state(context);
    if (current.running) return current;
    await Bun.sleep(50);
  }
  throw new ApiError("COMMAND_FAILED", "Lock did not become ready; inspect the Quickshell log");
}
/** The shell arbitrates stop against lock requests in its event loop; never kill a secure lock. */
export async function stop(context: LockRenderer) {
  if (!(await state(context)).running) return state(context);
  const response = await ipc(context, "stop");
  if (response.stdout !== "ok")
    throw new ApiError("CONFLICT", "Unlock the session before stopping or restarting Lock");
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const current = await state(context);
    if (!current.running) return current;
    await Bun.sleep(50);
  }
  throw new ApiError("COMMAND_FAILED", "Lock did not stop; its process has been left intact");
}

/** A requested lock is not secure until the compositor acknowledges coverage of every output. */
export async function acquire(context: LockRenderer, idle: boolean) {
  const response = await ipc(context, idle ? "lockIdle" : "lock");
  if (response.stdout !== "ok")
    throw new ApiError("COMMAND_FAILED", `Lock request rejected: ${response.stdout}`);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const current = await state(context);
    if (current.status === "locked" || (idle && current.status === "idle")) return current;
    if (current.status === "idle" || current.status === "stopped") break;
    await Bun.sleep(50);
  }
  // A failed readiness check must never tear down a possibly secure session lock.
  throw new ApiError(
    "COMMAND_FAILED",
    "The compositor did not confirm the session lock; inspect the Quickshell log",
  );
}
export async function reload(context: LockRenderer, settings: LockSettings) {
  const response = await ipc(context, "reload", [
    JSON.stringify(settings),
    JSON.stringify(await themeSnapshot(context)),
  ]);
  if (response.stdout !== "ok")
    throw new ApiError("COMMAND_FAILED", `Lock rejected settings: ${response.stdout}`);
  return state(context);
}
export async function snapshot(context: LockRenderer) {
  const response = await ipc(context, "snapshot");
  try {
    return lockSettingsSchema.parse(JSON.parse(response.stdout));
  } catch (error) {
    throw new ApiError("COMMAND_FAILED", `Invalid lock snapshot: ${String(error)}`);
  }
}
