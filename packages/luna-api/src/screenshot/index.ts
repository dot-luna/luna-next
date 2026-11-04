import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "pathe";
import { locked } from "../lib/files.ts";
import { ApiError, respond } from "../lib/response.ts";
import {
  screenshotContext,
  checked,
  notify,
  type ScreenshotContext,
  type ScreenshotMode,
  type ScreenshotOptions,
  type ScreenshotResult,
} from "./context.ts";
import { captureArguments, settleMenu, validateMode } from "./selection.ts";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function reserve(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const time = new Date();
  const pad = (value: number, digits = 2) => String(value).padStart(digits, "0");
  const stamp = `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}_${pad(time.getHours())}-${pad(time.getMinutes())}-${pad(time.getSeconds())}_${pad(time.getMilliseconds(), 3)}`;
  const path = join(directory, `Screenshot_${stamp}_${randomUUID()}.png`);
  const file = await open(path, "wx", 0o600);
  await file.close();
  return path;
}

async function copyImage(context: ScreenshotContext, path: string) {
  const executable = Bun.which("wl-copy", { PATH: context.env.PATH ?? "" });
  if (!executable) throw new Error("Install wl-clipboard");
  const errorsPath = join(context.runtime, `clipboard-${randomUUID()}`);
  const errors = await open(errorsPath, "wx+", 0o600);
  try {
    // wl-copy forks an owner which can retain descriptors. A regular error file cannot
    // hold the API open like a captured stderr pipe, and image stdin is a regular file too.
    const child = Bun.spawn([executable, "--type", "image/png"], {
      env: context.env,
      stdin: Bun.file(path),
      stdout: "ignore",
      stderr: errors.fd,
      timeout: 10_000,
    });
    const code = await child.exited;
    if (code !== 0)
      throw new Error((await Bun.file(errorsPath).text()).trim() || `wl-copy failed (${code})`);
  } finally {
    await errors.close();
    await rm(errorsPath, { force: true });
  }
}

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
          await checked(context, ["grim", "-t", "png", ...args, path], 30_000);
          const signature = Buffer.from(await Bun.file(path).slice(0, png.length).arrayBuffer());
          if (!signature.equals(png))
            throw new ApiError("COMMAND_FAILED", "grim did not produce a PNG screenshot");
        } catch (error) {
          await rm(path, { force: true });
          throw error;
        }
        try {
          await copyImage(context, path);
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
  /** Save and copy a PNG, or return silent cancellation without a file. Clipboard failures
   * retain the completed image and report its path. Only one capture may run per runtime. */
  capture: (mode: ScreenshotMode = "region", options: ScreenshotOptions = {}) =>
    respond(() => capture(mode, options)),
};
