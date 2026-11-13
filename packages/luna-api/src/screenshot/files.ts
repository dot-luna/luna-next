import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "pathe";
import { ApiError } from "../lib/response.ts";
import { checked, type ScreenshotContext } from "./context.ts";

export async function reserve(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const time = new Date();
  const pad = (value: number, digits = 2) => String(value).padStart(digits, "0");
  const stamp = `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}_${pad(time.getHours())}-${pad(time.getMinutes())}-${pad(time.getSeconds())}_${pad(time.getMilliseconds(), 3)}`;
  const path = join(directory, `Screenshot_${stamp}_${randomUUID()}.png`);
  const file = await open(path, "wx", 0o600);
  await file.close();
  return path;
}

export async function copyFile(context: ScreenshotContext, path: string, mime: string) {
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
export async function capturePng(context: ScreenshotContext, args: string[], path: string) {
  await checked(context, ["grim", "-t", "png", ...args, path], 30_000);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const signature = Buffer.from(await Bun.file(path).slice(0, png.length).arrayBuffer());
  if (!signature.equals(png))
    throw new ApiError("COMMAND_FAILED", "grim did not produce a PNG screenshot");
}
