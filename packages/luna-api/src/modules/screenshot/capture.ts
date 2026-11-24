import { rm } from "node:fs/promises";
import { join } from "pathe";
import { locked } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import {
  screenshotContext,
  type ScreenshotMode,
  type ScreenshotOptions,
  type ScreenshotResult,
} from "./context.ts";
import { screenshotFiles } from "./files.ts";
import { screenshotSelection } from "./selection.ts";
import { screenshotTools } from "./tools.ts";

class ScreenshotCapture {
  /**
   * Save a PNG and copy it under the capture lock. A failed capture removes its reserved file;
   * a clipboard failure keeps the saved image and names its path in the error.
   */
  async capture({
    mode,
    options,
  }: {
    mode: ScreenshotMode;
    options: ScreenshotOptions;
  }): Promise<ScreenshotResult> {
    screenshotSelection.validateMode(mode);
    const context = screenshotContext.resolve(options);
    try {
      for (const tool of [
        "grim",
        ...(mode === "region" ? ["slurp"] : []),
        ...(["screen", "window"].includes(mode) ? ["hyprctl"] : []),
      ]) {
        if (!Bun.which(tool, { PATH: context.env.PATH ?? "" }))
          throw new ApiError("COMMAND_FAILED", `Install ${tool} before taking a screenshot`);
      }
      return await locked(
        { configFile: join(context.runtime, "capture"), env: context.env },
        async () => {
          await screenshotSelection.settleMenu({ context, repository: options.repository });
          const args = await screenshotSelection.captureArguments({ context, mode });
          if (args === null) return { cancelled: true, path: null };
          const path = await screenshotFiles.reserve(context.directory);
          try {
            await screenshotFiles.capturePng({ context, args, path });
          } catch (error) {
            await rm(path, { force: true });
            throw error;
          }
          try {
            await screenshotFiles.copy({ context, path, mime: "image/png" });
          } catch (error) {
            throw new ApiError(
              "COMMAND_FAILED",
              `Screenshot saved to ${path}, but copying to the clipboard failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          await screenshotTools.notify({
            context,
            title: "Screenshot saved",
            body: "Copied to the clipboard.",
            path,
          });
          return { cancelled: false, path };
        },
      );
    } catch (error) {
      await screenshotTools.notify({
        context,
        title: "Screenshot failed",
        body: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const screenshotCapture = new ScreenshotCapture();
