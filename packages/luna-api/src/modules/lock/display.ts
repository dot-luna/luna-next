import { capture } from "@/lib/process.ts";
import { ApiError } from "@/lib/response.ts";
import type { LockRenderer } from "./context.ts";
import { lockRuntime } from "./runtime.ts";

class LockDisplay {
  /**
   * Switch Hyprland display power. Off applies only while securely locked and the shell
   * still reports display idle; otherwise the current state returns unchanged.
   */
  async power({ context, mode }: { context: LockRenderer; mode: "on" | "off" }) {
    if (mode !== "on" && mode !== "off")
      throw new ApiError("INVALID_ARGUMENT", "Display power must be on or off");
    if (mode === "off") {
      const current = await lockRuntime.state(context);
      if (current.status !== "locked") return current;
      const intent = await lockRuntime.ipc({ context, method: "canPowerOff" });
      if (intent.stdout === "false") return current;
      if (intent.stdout !== "true")
        throw new ApiError("COMMAND_FAILED", `Invalid lock power intent: ${intent.stdout}`);
    }
    if (!context.env.HYPRLAND_INSTANCE_SIGNATURE)
      throw new ApiError("INVALID_ENVIRONMENT", "Lock display power requires a Hyprland session");
    const executable = Bun.which("hyprctl", { PATH: context.env.PATH });
    if (!executable)
      throw new ApiError("COMMAND_FAILED", "Install Hyprctl to control display power");
    const action = mode === "off" ? "disable" : "enable";
    const { code, stdout, stderr } = await capture({
      args: [executable, "dispatch", `hl.dsp.dpms({ action = "${action}" })`],
      env: context.env,
      timeout: 5000,
    });
    if (code !== 0 || stdout.trim() !== "ok")
      throw new ApiError(
        "COMMAND_FAILED",
        `Display power failed (${code}): ${(stderr || stdout).trim()}`,
      );
    return lockRuntime.state(context);
  }
}

export const lockDisplay = new LockDisplay();
