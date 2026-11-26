import { quickshell } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";
import { themeSelection } from "@/modules/theme/lib/selection.ts";
import { themeContext } from "@/modules/theme/lib/context.ts";
import type { MenuContext } from "./context.ts";

class MenuRuntime {
  ipc({
    context,
    method,
    args,
    allowFailure,
  }: {
    context: MenuContext;
    method: string;
    args?: string[];
    allowFailure?: boolean;
  }) {
    return quickshell.ipc({ context, target: "menu", method, args, label: "Menu", allowFailure });
  }

  async running(context: MenuContext) {
    const result = await this.ipc({ context, method: "status", allowFailure: true });
    return result.code === 0 && result.stdout === "running";
  }

  /** Start a hidden instance unless one is running; a running instance keeps its theme snapshot. */
  async start(context: MenuContext) {
    if (await this.running(context)) return;
    // Resolve once per process start; the renderer never reads or watches theme sources.
    context.env.LUNA_MENU_THEME = JSON.stringify(
      await themeSelection.current(themeContext.resolve({ env: context.env })),
    );
    await quickshell.command({
      context,
      args: ["--no-color", "--daemonize", "--no-duplicate", "-p", context.shellDirectory],
      label: "Menu",
    });
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await this.running(context)) return;
      await Bun.sleep(50);
    }
    throw new ApiError("COMMAND_FAILED", "Menu did not become ready; inspect the Quickshell log");
  }

  async stop(context: MenuContext) {
    if (await this.running(context))
      await quickshell.command({
        context,
        args: ["kill", "-p", context.shellDirectory],
        label: "Menu",
      });
  }
}

export const menuRuntime = new MenuRuntime();
