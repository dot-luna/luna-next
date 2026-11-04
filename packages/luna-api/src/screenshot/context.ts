import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "pathe";
import { ApiError } from "../lib/response.ts";

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

export function screenshotContext(options: ScreenshotOptions) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? Bun.env))
    if (value !== undefined) env[key] = value;
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
  const runtime = env.XDG_RUNTIME_DIR || join(tmpdir(), `luna-${process.getuid?.() ?? "user"}`);
  // oxlint-disable-next-line no-control-regex
  if (!directory || /[\x00-\x1f\x7f]/u.test(directory) || resolve(directory) === "/")
    throw new ApiError("INVALID_PATH", "Use a nonempty screenshot directory other than root");
  if (!isAbsolute(runtime) || runtime === "/")
    throw new ApiError("INVALID_PATH", "XDG_RUNTIME_DIR must be an absolute non-root path");
  return { env, directory: resolve(directory), runtime: join(runtime, "luna-screenshot") };
}
export type ScreenshotContext = ReturnType<typeof screenshotContext>;

/** Capture tool diagnostics without a shell; zero timeout allows interactive selection. */
export async function command(context: ScreenshotContext, args: string[], timeout = 10_000) {
  const executable = Bun.which(args[0]!, { PATH: context.env.PATH ?? "" });
  if (!executable)
    throw new ApiError("COMMAND_FAILED", `Install ${args[0]} before taking a screenshot`);
  const child = Bun.spawn([executable, ...args.slice(1)], {
    env: context.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ...(timeout > 0 ? { timeout } : {}),
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), code };
}

export async function checked(context: ScreenshotContext, args: string[], timeout?: number) {
  const result = await command(context, args, timeout);
  if (result.code !== 0)
    throw new ApiError("COMMAND_FAILED", `${args[0]} failed (${result.code}): ${result.stderr}`);
  return result.stdout;
}

/** Notification availability never changes the capture result. */
export async function notify(
  context: ScreenshotContext,
  title: string,
  body: string,
  path?: string,
) {
  const env = { ...context.env };
  delete env.LD_LIBRARY_PATH;
  delete env.LD_PRELOAD;
  try {
    await command(
      { ...context, env },
      [
        "notify-send",
        "--app-name=Luna Screenshot",
        "--icon=video-display",
        "--urgency=normal",
        ...(path ? [`--hint=string:image-path:${path}`] : []),
        "--",
        title,
        body,
      ],
      3000,
    );
  } catch {
    /* Notification feedback is optional. */
  }
}
