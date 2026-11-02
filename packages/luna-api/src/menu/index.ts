import { respond, ApiError } from "../lib/response.ts";
import { currentTheme } from "../theme/selection.ts";
import { themeContext } from "../theme/context.ts";
import {
  command,
  ipc,
  menuContext,
  type MenuContext,
  type MenuOptions,
  type MenuState,
} from "./context.ts";

async function running(context: MenuContext) {
  const result = await ipc(context, "status", true);
  return result.code === 0 && result.stdout === "running";
}

async function start(context: MenuContext) {
  if (await running(context)) return;
  // Resolve once per process start; the renderer never reads or watches theme sources.
  context.env.LUNA_MENU_THEME = JSON.stringify(
    await currentTheme(themeContext({ env: context.env })),
  );
  await command(context, [
    "--no-color",
    "--daemonize",
    "--no-duplicate",
    "-p",
    context.shellDirectory,
  ]);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await running(context)) return;
    await Bun.sleep(50);
  }
  throw new ApiError("COMMAND_FAILED", "Menu did not become ready; inspect the Quickshell log");
}

async function operate(
  action: "status" | "start" | "show" | "hide" | "toggle" | "stop" | "system",
  options: MenuOptions,
) {
  const context = await menuContext(options);
  if (action === "start" || action === "show" || action === "toggle" || action === "system")
    await start(context);
  if (action === "show" || action === "toggle" || action === "system") await ipc(context, action);
  if (action === "hide" && (await running(context))) await ipc(context, "hide");
  if (action === "stop" && (await running(context)))
    await command(context, ["kill", "-p", context.shellDirectory]);
  return {
    running: await running(context),
    shellDirectory: context.shellDirectory,
  } satisfies MenuState;
}

/** Show/toggle/system start a hidden instance when needed. Existing instances retain their theme snapshot. */
export const menu = {
  status: (options: MenuOptions = {}) => respond(() => operate("status", options)),
  start: (options: MenuOptions = {}) => respond(() => operate("start", options)),
  show: (options: MenuOptions = {}) => respond(() => operate("show", options)),
  system: (options: MenuOptions = {}) => respond(() => operate("system", options)),
  hide: (options: MenuOptions = {}) => respond(() => operate("hide", options)),
  toggle: (options: MenuOptions = {}) => respond(() => operate("toggle", options)),
  stop: (options: MenuOptions = {}) => respond(() => operate("stop", options)),
};
