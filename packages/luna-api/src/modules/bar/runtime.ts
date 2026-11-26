import { quickshell } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";
import { themeSelection } from "@/modules/theme/lib/selection.ts";
import { themeContext } from "@/modules/theme/lib/context.ts";
import type { BarContext, BarState } from "./context.ts";
import { barSettings } from "./settings.ts";

class BarRuntime {
  /** A bar that does not answer IPC with "running" is treated as stopped. */
  async running(context: BarContext) {
    const result = await this._ipc({ context, method: "status", allowFailure: true });
    return result.code === 0 && result.stdout === "running";
  }

  async state(context: BarContext): Promise<BarState> {
    return {
      running: await this.running(context),
      shellDirectory: context.shellDirectory,
      configFile: context.configFile,
    };
  }

  /**
   * Launch a bar with fresh theme and settings snapshots and wait up to 3s for IPC readiness.
   * `replace` stops the running bar only after both resolve, so an invalid theme or
   * settings file leaves it intact.
   */
  async launch({ context, replace }: { context: BarContext; replace: boolean }) {
    context.env.LUNA_BAR_THEME = JSON.stringify(
      await themeSelection.current(themeContext.resolve({ env: context.env })),
    );
    context.env.LUNA_BAR_SETTINGS = JSON.stringify(await barSettings.snapshot(context));
    if (replace) await this.kill(context);
    await this._command({
      context,
      args: ["--no-color", "--daemonize", "--no-duplicate", "-p", context.shellDirectory],
    });
    const deadline = Date.now() + 3000;
    while (!(await this.running(context))) {
      if (Date.now() >= deadline)
        throw new ApiError(
          "COMMAND_FAILED",
          "Bar did not become ready; inspect the Quickshell log",
        );
      await Bun.sleep(50);
    }
  }

  async kill(context: BarContext) {
    await this._command({ context, args: ["kill", "-p", context.shellDirectory] });
  }

  /** IPC methods take no arguments; focus also reveals a hidden bar. */
  async send({ context, method }: { context: BarContext; method: "focus" | "toggle" }) {
    await this._ipc({ context, method });
  }

  private _command({ context, args }: { context: BarContext; args: string[] }) {
    return quickshell.command({ context, args, label: "Bar" });
  }

  private _ipc({
    context,
    method,
    allowFailure,
  }: {
    context: BarContext;
    method: string;
    allowFailure?: boolean;
  }) {
    return quickshell.ipc({ context, target: "bar", method, label: "Bar", allowFailure });
  }
}

export const barRuntime = new BarRuntime();
