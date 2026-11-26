import { z } from "zod";
import { menu } from "@/modules/menu/index.ts";
import { ApiError } from "@/lib/response.ts";
import type { ScreenshotContext, ScreenshotMode } from "./context.ts";
import { screenshotTools } from "./tools.ts";

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

class ScreenshotSelection {
  validateMode(mode: ScreenshotMode) {
    if (!modeSchema.safeParse(mode).success)
      throw new ApiError("INVALID_ARGUMENT", "Choose region, screen, window, or all");
  }

  /** Dismiss only an existing menu and let compositor layers disappear before reading pixels. */
  async settleMenu({ context, repository }: { context: ScreenshotContext; repository?: string }) {
    await menu.hide({ env: context.env, repository });
    await Bun.sleep(200);
    const deadline = Date.now() + 1500;
    while (true) {
      let layers: unknown;
      try {
        const result = await screenshotTools.run({
          context,
          args: ["hyprctl", "-j", "layers"],
          timeout: 2000,
        });
        if (result.code !== 0) return;
        layers = JSON.parse(result.stdout);
      } catch {
        return;
      }
      if (!this._menuVisible(layers)) return;
      if (Date.now() >= deadline)
        throw new ApiError("COMMAND_FAILED", "Luna's menu did not close; screenshot was not taken");
      await Bun.sleep(50);
    }
  }

  /** Return grim arguments for the mode, or null when the user cancels a region selection. */
  async captureArguments({ context, mode }: { context: ScreenshotContext; mode: ScreenshotMode }) {
    if (mode === "region") {
      const result = await screenshotTools.run({
        context,
        args: ["slurp", "-f", "%x,%y %wx%h"],
        timeout: 0,
      });
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
      const raw = await screenshotTools.checked({
        context,
        args: ["hyprctl", "-j", "monitors"],
        timeout: 2000,
      });
      const monitors = monitorsSchema.safeParse(
        this._json(raw, "Could not read the focused monitor"),
      );
      const focused = monitors.success && monitors.data.find((monitor) => monitor.focused);
      if (!focused) throw new ApiError("COMMAND_FAILED", "No focused monitor is available");
      // Grim interprets output scale and transform; Hyprland's logical geometry is not rescaled here.
      return ["-o", focused.name];
    }
    if (mode === "window") {
      const raw = await screenshotTools.checked({
        context,
        args: ["hyprctl", "-j", "activewindow"],
        timeout: 2000,
      });
      const window = windowSchema.safeParse(this._json(raw, "Could not read the active window"));
      if (!window.success || window.data.mapped === false)
        throw new ApiError("COMMAND_FAILED", "No active window with usable geometry is available");
      const { at, size } = window.data;
      return ["-g", `${at[0]},${at[1]} ${size[0]}x${size[1]}`];
    }
    return [];
  }

  private _json(raw: string, message: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      throw new ApiError("COMMAND_FAILED", message);
    }
  }

  private _menuVisible(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return (
      ["luna-menu", "luna-menu-dismiss"].includes(String(record.namespace)) ||
      Object.values(record).some((child) => this._menuVisible(child))
    );
  }
}

export const screenshotSelection = new ScreenshotSelection();
