import { ApiError } from "../lib/response.ts";
import type { LockRenderer } from "./context.ts";
import { ipc, state } from "./runtime.ts";

/** Off requests recheck native idle state; the shell serializes them with any later wake request. */
export async function display(context: LockRenderer, mode: "on" | "off") {
  if (mode !== "on" && mode !== "off")
    throw new ApiError("INVALID_ARGUMENT", "Display power must be on or off");
  if (mode === "off") {
    const current = await state(context);
    if (current.status !== "locked") return current;
    const intent = await ipc(context, "canPowerOff");
    if (intent.stdout === "false") return current;
    if (intent.stdout !== "true")
      throw new ApiError("COMMAND_FAILED", `Invalid lock power intent: ${intent.stdout}`);
  }
  if (!context.env.HYPRLAND_INSTANCE_SIGNATURE)
    throw new ApiError("INVALID_ENVIRONMENT", "Lock display power requires a Hyprland session");
  const executable = Bun.which("hyprctl", { PATH: context.env.PATH });
  if (!executable) throw new ApiError("COMMAND_FAILED", "Install Hyprctl to control display power");
  const action = mode === "off" ? "disable" : "enable";
  const child = Bun.spawn([executable, "dispatch", `hl.dsp.dpms({ action = "${action}" })`], {
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
  if (code !== 0 || stdout.trim() !== "ok")
    throw new ApiError(
      "COMMAND_FAILED",
      `Display power failed (${code}): ${(stderr || stdout).trim()}`,
    );
  return state(context);
}
