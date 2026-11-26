import { quickshell } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";
import type { PolkitContext, PolkitState } from "./context.ts";
import { polkitSettings } from "./settings.ts";

/** Control only Luna's shell; native PolkitAgent owns registration and authentication. */
class PolkitRuntime {
  async state(context: PolkitContext): Promise<PolkitState> {
    const result = await quickshell.ipc({
      context,
      target: "polkit",
      method: "status",
      label: "Polkit",
      allowFailure: true,
    });
    const status = result.code === 0 ? result.stdout : "stopped";
    if (status !== "running" && status !== "unavailable" && status !== "stopped")
      throw new ApiError("COMMAND_FAILED", `Unexpected polkit status: ${status}`);
    return {
      running: status === "running",
      status,
      shellDirectory: context.shellDirectory,
      configFile: context.configFile,
    };
  }

  /** Load the real UI without registering, before stopping a working agent. */
  async prepare(context: PolkitContext) {
    const snapshot = await polkitSettings.snapshot(context);
    const env: Record<string, string> = {
      ...context.env,
      LUNA_POLKIT_THEME: JSON.stringify(snapshot.theme),
      LUNA_POLKIT_SETTINGS: JSON.stringify(snapshot.settings),
    };
    delete env.LUNA_POLKIT_VALIDATE;
    const prepared = { ...context, env };
    const result = await quickshell.command({
      context: { ...prepared, env: { ...env, LUNA_POLKIT_VALIDATE: "1" } },
      args: ["--no-color", "-p", context.shellDirectory],
      label: "Polkit validation",
    });
    if (!result.stdout.includes("Luna polkit validation passed"))
      throw new ApiError("COMMAND_FAILED", "Polkit UI validation did not complete");
    return prepared;
  }

  /** Resolve only after native registration; a rejected registration never replaces another agent. */
  async start(context: PolkitContext) {
    await quickshell.command({
      context,
      args: ["--no-color", "--daemonize", "--no-duplicate", "-p", context.shellDirectory],
      label: "Polkit",
    });
    try {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const state = await this.state(context);
        if (state.running) return state;
        if (state.status === "stopped") break;
        await Bun.sleep(100);
      }
      throw new ApiError(
        "COMMAND_FAILED",
        "Polkit could not register. Use a desktop session and stop other authentication agents before starting Luna Polkit.",
      );
    } catch (error) {
      await this.stop(context);
      throw error;
    }
  }

  async stop(context: PolkitContext) {
    if ((await this.state(context)).status !== "stopped")
      await quickshell.command({
        context,
        args: ["kill", "-p", context.shellDirectory],
        label: "Polkit",
      });
    return this.state(context);
  }
}
export const polkitRuntime = new PolkitRuntime();
