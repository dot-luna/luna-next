import { metadata } from "../lib/files.ts";
import { ApiError } from "../lib/response.ts";
import { currentTheme } from "../theme/selection.ts";
import { themeContext } from "../theme/context.ts";
import {
  desktopLockSchema,
  screensaverSettingsSchema,
  type ScreensaverSettings,
} from "./schema.ts";
import type { ScreensaverRenderer, ScreensaverState } from "./context.ts";

async function execute(context: ScreensaverRenderer, args: string[], allowFailure = false) {
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
      `Screensaver command failed (${code}): ${(stderr || stdout).trim()}`,
    );
  return { code, stdout: stdout.trim() };
}
export function command(context: ScreensaverRenderer, args: string[], allowFailure = false) {
  return execute(context, [context.executable, ...args], allowFailure);
}
export function ipc(
  context: ScreensaverRenderer,
  method: string,
  args: string[] = [],
  allowFailure = false,
) {
  return command(
    context,
    ["ipc", "-p", context.shellDirectory, "call", "--", "screensaver", method, ...args],
    allowFailure,
  );
}
export async function state(context: ScreensaverRenderer): Promise<ScreensaverState> {
  const response = await ipc(context, "status", [], true);
  const status = response.code !== 0 ? "stopped" : response.stdout;
  if (status !== "stopped" && status !== "hidden" && status !== "visible")
    throw new ApiError("COMMAND_FAILED", `Unexpected screensaver status: ${status}`);
  return {
    running: status !== "stopped",
    status,
    shellDirectory: context.shellDirectory,
    configFile: context.configFile,
  };
}
export function themeSnapshot(context: ScreensaverRenderer) {
  return currentTheme(themeContext({ env: context.env }));
}
export async function start(context: ScreensaverRenderer, settings: ScreensaverSettings) {
  if (!context.launcher || !(await metadata(context.launcher))?.isFile())
    throw new ApiError(
      "INVALID_PATH",
      "Build/install the Luna CLI or supply a screensaver launcher",
    );
  const args = [context.launcher, "screensaver", "--config", context.configFile];
  if (context.repository) args.push("--install-dir", context.repository);
  const env = {
    ...context.env,
    LUNA_SCREENSAVER_SETTINGS: JSON.stringify(settings),
    LUNA_SCREENSAVER_THEME: JSON.stringify(await themeSnapshot(context)),
    LUNA_SCREENSAVER_COMMAND: JSON.stringify(args),
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
  throw new ApiError(
    "COMMAND_FAILED",
    "Screensaver did not become ready; inspect the Quickshell log",
  );
}
export async function stop(context: ScreensaverRenderer) {
  if ((await state(context)).running)
    await command(context, ["kill", "-p", context.shellDirectory]);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const current = await state(context);
    if (!current.running) return current;
    await Bun.sleep(50);
  }
  throw new ApiError("COMMAND_FAILED", "Screensaver did not stop");
}
export async function reload(context: ScreensaverRenderer, settings: ScreensaverSettings) {
  const response = await ipc(context, "reload", [
    JSON.stringify(settings),
    JSON.stringify(await themeSnapshot(context)),
  ]);
  if (response.stdout !== "ok")
    throw new ApiError("COMMAND_FAILED", `Screensaver rejected settings: ${response.stdout}`);
  return state(context);
}
export async function snapshot(context: ScreensaverRenderer) {
  const response = await ipc(context, "snapshot");
  try {
    return screensaverSettingsSchema.parse(JSON.parse(response.stdout));
  } catch (error) {
    throw new ApiError("COMMAND_FAILED", `Invalid screensaver snapshot: ${String(error)}`);
  }
}
/** A screensaver is presentation only; never place it over a secure Hyprland lock. */
export async function sessionLocked(context: ScreensaverRenderer) {
  if (!context.env.HYPRLAND_INSTANCE_SIGNATURE) return false;
  const executable = Bun.which("hyprctl", { PATH: context.env.PATH });
  if (!executable)
    throw new ApiError("COMMAND_FAILED", "Hyprctl is required to inspect this Hyprland session");
  const response = await execute(context, [executable, "-j", "locked"]);
  try {
    return desktopLockSchema.parse(JSON.parse(response.stdout)).locked;
  } catch (error) {
    throw new ApiError("COMMAND_FAILED", `Cannot read the session lock state: ${String(error)}`);
  }
}
