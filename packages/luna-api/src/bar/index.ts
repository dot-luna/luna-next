import { respond, ApiError } from "../lib/response.ts";
import { currentTheme } from "../theme/selection.ts";
import { themeContext } from "../theme/context.ts";
import {
  command,
  ipc,
  barContext,
  type BarContext,
  type BarOptions,
  type BarState,
} from "./context.ts";

async function running(context: BarContext) {
  const result = await ipc(context, "status", true);
  return result.code === 0 && result.stdout === "running";
}

async function operate(
  action: "status" | "start" | "stop" | "restart" | "focus",
  options: BarOptions,
) {
  const context = await barContext(options);
  const wasRunning = await running(context);
  if (action === "restart" || ((action === "start" || action === "focus") && !wasRunning)) {
    // Resolve before replacing a running bar so invalid theme sources leave it intact.
    context.env.LUNA_BAR_THEME = JSON.stringify(
      await currentTheme(themeContext({ env: context.env })),
    );
    if (wasRunning) await command(context, ["kill", "-p", context.shellDirectory]);
    await command(context, [
      "--no-color",
      "--daemonize",
      "--no-duplicate",
      "-p",
      context.shellDirectory,
    ]);
    const deadline = Date.now() + 3000;
    while (!(await running(context))) {
      if (Date.now() >= deadline)
        throw new ApiError(
          "COMMAND_FAILED",
          "Bar did not become ready; inspect the Quickshell log",
        );
      await Bun.sleep(50);
    }
  }
  if (action === "focus") await ipc(context, "focus");
  if (action === "stop" && wasRunning)
    await command(context, ["kill", "-p", context.shellDirectory]);
  return {
    running: await running(context),
    shellDirectory: context.shellDirectory,
  } satisfies BarState;
}

/** Start/focus reuse an existing instance; restart reads a fresh theme snapshot. */
export const bar = {
  status: (options: BarOptions = {}) => respond(() => operate("status", options)),
  start: (options: BarOptions = {}) => respond(() => operate("start", options)),
  stop: (options: BarOptions = {}) => respond(() => operate("stop", options)),
  restart: (options: BarOptions = {}) => respond(() => operate("restart", options)),
  focus: (options: BarOptions = {}) => respond(() => operate("focus", options)),
};
