import { rm } from "node:fs/promises";
import { join } from "pathe";
import { locked } from "../lib/files.ts";
import { ApiError, respond } from "../lib/response.ts";
import {
  screenshotContext,
  notify,
  type ScreenshotMode,
  type ScreenshotOptions,
  type ScreenshotResult,
  type ScreenshotTextOptions,
} from "./context.ts";
import { capturePng, copyFile, reserve } from "./files.ts";
import { captureArguments, settleMenu, validateMode } from "./selection.ts";
import { extractText } from "./text.ts";

async function capture(
  mode: ScreenshotMode,
  options: ScreenshotOptions,
): Promise<ScreenshotResult> {
  validateMode(mode);
  const context = screenshotContext(options);
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
        await settleMenu(context, options);
        const args = await captureArguments(context, mode);
        if (args === null) return { cancelled: true, path: null };
        const path = await reserve(context.directory);
        try {
          await capturePng(context, args, path);
        } catch (error) {
          await rm(path, { force: true });
          throw error;
        }
        try {
          await copyFile(context, path, "image/png");
        } catch (error) {
          throw new ApiError(
            "COMMAND_FAILED",
            `Screenshot saved to ${path}, but copying to the clipboard failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        await notify(context, "Screenshot saved", "Copied to the clipboard.", path);
        return { cancelled: false, path };
      },
    );
  } catch (error) {
    await notify(
      context,
      "Screenshot failed",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

export const screenshot = {
  /** Select a region and copy English text. Cancellation and empty recognition keep the
   * clipboard; temporary captures are removed on success and failure. Shares the capture lock. */
  extractText: (options: ScreenshotTextOptions = {}) => respond(() => extractText(options)),
  /** Save and copy a PNG, or return silent cancellation without a file. Clipboard failures
   * retain the completed image and report its path. Only one capture may run per runtime. */
  capture: (mode: ScreenshotMode = "region", options: ScreenshotOptions = {}) =>
    respond(() => capture(mode, options)),
};
