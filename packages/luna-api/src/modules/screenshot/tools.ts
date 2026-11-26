import { capture } from "@/lib/process.ts";
import { ApiError } from "@/lib/response.ts";
import type { ScreenshotContext } from "./context.ts";

class ScreenshotTools {
  /**
   * Run a tool from PATH without a shell and return trimmed output and the exit code.
   * A zero timeout allows interactive selection; a missing tool fails with COMMAND_FAILED.
   */
  async run({
    context,
    args,
    timeout = 10_000,
  }: {
    context: ScreenshotContext;
    args: string[];
    timeout?: number;
  }) {
    const executable = Bun.which(args[0]!, { PATH: context.env.PATH ?? "" });
    if (!executable)
      throw new ApiError("COMMAND_FAILED", `Install ${args[0]} before taking a screenshot`);
    const result = await capture({
      args: [executable, ...args.slice(1)],
      env: context.env,
      timeout: timeout > 0 ? timeout : undefined,
    });
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), code: result.code };
  }

  /** Like run, but a nonzero exit fails with COMMAND_FAILED; returns trimmed stdout. */
  async checked(options: { context: ScreenshotContext; args: string[]; timeout?: number }) {
    const result = await this.run(options);
    if (result.code !== 0)
      throw new ApiError(
        "COMMAND_FAILED",
        `${options.args[0]} failed (${result.code}): ${result.stderr}`,
      );
    return result.stdout;
  }

  /** Show desktop feedback; notification availability never changes the capture result. */
  async notify({
    context,
    title,
    body,
    path,
  }: {
    context: ScreenshotContext;
    title: string;
    body: string;
    /** Image preview for the notification. */
    path?: string;
  }) {
    const env = { ...context.env };
    delete env.LD_LIBRARY_PATH;
    delete env.LD_PRELOAD;
    try {
      await this.run({
        context: { ...context, env },
        args: [
          "notify-send",
          "--app-name=Luna Screenshot",
          "--icon=video-display",
          "--urgency=normal",
          ...(path ? [`--hint=string:image-path:${path}`] : []),
          "--",
          title,
          body,
        ],
        timeout: 3000,
      });
    } catch {
      /* Notification feedback is optional. */
    }
  }
}

export const screenshotTools = new ScreenshotTools();
