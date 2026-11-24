import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "pathe";
import { environment } from "@/lib/env.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";

export type ScreenshotMode = "region" | "screen" | "window" | "all";

export interface ScreenshotOptions {
  /** Replaces Bun.env for tools, the clipboard, and screenshot paths. */
  env?: Record<string, string>;
  /** Select the source menu to dismiss before capturing. */
  repository?: string;
  /** Overrides LUNA_SCREENSHOT_DIR; relative paths use the caller's working directory. */
  directory?: string;
}

export interface ScreenshotResult {
  cancelled: boolean;
  path: string | null;
}

export interface ScreenshotTextOptions extends Omit<ScreenshotOptions, "directory"> {
  /** Explicit JSONC path; relative paths use the caller's working directory. */
  configFile?: string;
}

export interface ScreenshotTextResult {
  cancelled: boolean;
  /** null on cancellation, empty when no text was recognized; otherwise the copied text. */
  text: string | null;
}

export interface ScreenshotContext {
  env: Record<string, string>;
  /** Per-user directory for the capture lock and transient files. */
  runtime: string;
}

export interface ScreenshotCaptureContext extends ScreenshotContext {
  /** Absolute destination for saved screenshots. */
  directory: string;
}

class ScreenshotContextResolver {
  /** Resolve the environment and runtime directory shared by captures and text extraction. */
  runtime(options: Pick<ScreenshotOptions, "env">): ScreenshotContext {
    const env = environment(options.env);
    const runtime = env.XDG_RUNTIME_DIR || join(tmpdir(), `luna-${process.getuid?.() ?? "user"}`);
    if (!isAbsolute(runtime) || runtime === "/")
      throw new ApiError("INVALID_PATH", "XDG_RUNTIME_DIR must be an absolute non-root path");
    return { env, runtime: join(runtime, "luna-screenshot") };
  }

  /**
   * Add the save directory: directory, then LUNA_SCREENSHOT_DIR, then ~/Pictures/Screenshots.
   * A leading `~` expands to HOME; root and control characters fail with INVALID_PATH.
   */
  resolve(options: ScreenshotOptions): ScreenshotCaptureContext {
    const context = this.runtime(options);
    const { env } = context;
    let directory = options.directory ?? env.LUNA_SCREENSHOT_DIR;
    if (directory === undefined) {
      if (!env.HOME || !isAbsolute(env.HOME))
        throw new ApiError("INVALID_PATH", "Set HOME or a screenshot directory");
      directory = join(env.HOME, "Pictures/Screenshots");
    }
    if (directory === "~" || directory.startsWith("~/")) {
      if (!env.HOME || !isAbsolute(env.HOME))
        throw new ApiError("INVALID_PATH", "Set HOME to expand the screenshot directory");
      directory = env.HOME + directory.slice(1);
    }
    if (!directory || hasControlCharacters(directory) || resolve(directory) === "/")
      throw new ApiError("INVALID_PATH", "Use a nonempty screenshot directory other than root");
    return { ...context, directory: resolve(directory) };
  }
}

export const screenshotContext = new ScreenshotContextResolver();
