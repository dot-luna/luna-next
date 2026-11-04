import { z } from "zod";
import { menu } from "../menu/index.ts";
import { ApiError } from "../lib/response.ts";
import {
  command,
  checked,
  type ScreenshotContext,
  type ScreenshotMode,
  type ScreenshotOptions,
} from "./context.ts";

const modeSchema = z.enum(["region", "screen", "window", "all"]);
const point = z.tuple([z.number().int(), z.number().int()]);
const windowSchema = z.object({
  mapped: z.boolean().optional(),
  at: point,
  size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
});
const monitorsSchema = z.array(
  z.object({ focused: z.boolean().optional(), name: z.string().min(1) }),
);

export function validateMode(mode: ScreenshotMode) {
  if (!modeSchema.safeParse(mode).success)
    throw new ApiError("INVALID_ARGUMENT", "Choose region, screen, window, or all");
}

function menuVisible(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    ["luna-menu", "luna-menu-dismiss"].includes(String(record.namespace)) ||
    Object.values(record).some(menuVisible)
  );
}

/** Dismiss only an existing menu and let compositor layers disappear before reading pixels. */
export async function settleMenu(context: ScreenshotContext, options: ScreenshotOptions) {
  await menu.hide({ env: context.env, repository: options.repository });
  await Bun.sleep(200);
  const deadline = Date.now() + 1500;
  while (true) {
    let layers: unknown;
    try {
      const result = await command(context, ["hyprctl", "-j", "layers"], 2000);
      if (result.code !== 0) return;
      layers = JSON.parse(result.stdout);
    } catch {
      return;
    }
    if (!menuVisible(layers)) return;
    if (Date.now() >= deadline)
      throw new ApiError("COMMAND_FAILED", "Luna's menu did not close; screenshot was not taken");
    await Bun.sleep(50);
  }
}

export async function captureArguments(context: ScreenshotContext, mode: ScreenshotMode) {
  if (mode === "region") {
    const result = await command(context, ["slurp", "-f", "%x,%y %wx%h"], 0);
    if (
      result.code === 1 &&
      ["", "selection cancelled", "selection canceled"].includes(result.stderr.toLowerCase())
    )
      return null;
    if (result.code !== 0)
      throw new ApiError("COMMAND_FAILED", result.stderr || `slurp failed (${result.code})`);
    if (!/^-?\d+,-?\d+ [1-9]\d*x[1-9]\d*$/u.test(result.stdout))
      throw new ApiError("COMMAND_FAILED", "No usable screenshot region was selected");
    await Bun.sleep(200);
    return ["-g", result.stdout];
  }
  if (mode === "screen") {
    const raw = await checked(context, ["hyprctl", "-j", "monitors"], 2000);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new ApiError("COMMAND_FAILED", "Could not read the focused monitor");
    }
    const monitors = monitorsSchema.safeParse(value);
    const focused = monitors.success && monitors.data.find((monitor) => monitor.focused);
    if (!focused) throw new ApiError("COMMAND_FAILED", "No focused monitor is available");
    // Grim interprets output scale and transform; Hyprland's logical geometry is not rescaled here.
    return ["-o", focused.name];
  }
  if (mode === "window") {
    const raw = await checked(context, ["hyprctl", "-j", "activewindow"], 2000);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new ApiError("COMMAND_FAILED", "Could not read the active window");
    }
    const window = windowSchema.safeParse(value);
    if (!window.success || window.data.mapped === false)
      throw new ApiError("COMMAND_FAILED", "No active window with usable geometry is available");
    const { at, size } = window.data;
    return ["-g", `${at[0]},${at[1]} ${size[0]}x${size[1]}`];
  }
  return [];
}
