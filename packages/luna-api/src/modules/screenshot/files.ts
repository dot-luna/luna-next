import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "pathe";
import { ApiError } from "@/lib/response.ts";
import type { ScreenshotContext } from "./context.ts";
import { screenshotTools } from "./tools.ts";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

class ScreenshotFiles {
  /** Create an empty owner-only file with a unique, local-time-stamped PNG name. */
  async reserve(directory: string) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const time = new Date();
    const pad = (value: number, digits = 2) => String(value).padStart(digits, "0");
    const stamp = `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}_${pad(time.getHours())}-${pad(time.getMinutes())}-${pad(time.getSeconds())}_${pad(time.getMilliseconds(), 3)}`;
    const path = join(directory, `Screenshot_${stamp}_${randomUUID()}.png`);
    const file = await open(path, "wx", 0o600);
    await file.close();
    return path;
  }

  /** Offer the file's bytes on the Wayland clipboard as `mime`. */
  async copy({ context, path, mime }: { context: ScreenshotContext; path: string; mime: string }) {
    const executable = Bun.which("wl-copy", { PATH: context.env.PATH ?? "" });
    if (!executable) throw new ApiError("COMMAND_FAILED", "Install wl-clipboard");
    const errorsPath = join(context.runtime, `clipboard-${randomUUID()}`);
    const errors = await open(errorsPath, "wx+", 0o600);
    try {
      // wl-copy forks an owner which can retain descriptors. A regular error file cannot
      // hold the API open like a captured stderr pipe, and stdin is a regular file too.
      const child = Bun.spawn([executable, "--type", mime], {
        env: context.env,
        stdin: Bun.file(path),
        stdout: "ignore",
        stderr: errors.fd,
        timeout: 10_000,
      });
      const code = await child.exited;
      if (code !== 0)
        throw new ApiError(
          "COMMAND_FAILED",
          (await Bun.file(errorsPath).text()).trim() || `wl-copy failed (${code})`,
        );
    } finally {
      await errors.close();
      await rm(errorsPath, { force: true });
    }
  }

  /** Reject failed or non-PNG captures before either clipboard or OCR consumes them. */
  async capturePng({
    context,
    args,
    path,
  }: {
    context: ScreenshotContext;
    /** grim selection arguments; empty captures all outputs. */
    args: string[];
    path: string;
  }) {
    await screenshotTools.checked({
      context,
      args: ["grim", "-t", "png", ...args, path],
      timeout: 30_000,
    });
    const signature = Buffer.from(await Bun.file(path).slice(0, pngSignature.length).arrayBuffer());
    if (!signature.equals(pngSignature))
      throw new ApiError("COMMAND_FAILED", "grim did not produce a PNG screenshot");
  }
}

export const screenshotFiles = new ScreenshotFiles();
