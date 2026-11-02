import { ApiError } from "../lib/response.ts";
import type { InstallContext } from "../self/install/command.ts";

export interface InstallFailure {
  app: string;
  code: string;
  error: string;
  retry: string;
  logDirectory: string;
}
export interface AppInstallResult {
  installed: string[];
  failed: InstallFailure[];
  completed: boolean;
  logDirectory: string;
}
export const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** Keep recoverable app failures in the final report; required prerequisite failures still stop. */
export async function attempt(
  context: InstallContext,
  app: string,
  retry: string,
  skipFailed: boolean,
  failed: InstallFailure[],
  operation: () => Promise<unknown>,
) {
  try {
    await operation();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = {
      app,
      code: error instanceof ApiError ? error.code : "IO_ERROR",
      error: message,
      retry,
      logDirectory: context.log.directory,
    };
    failed.push(failure);
    context.log.failures.push(failure);
    context.log.event({ type: "app-failed", ...failure });
    context.progress(
      `${app} failed: ${message.slice(0, 1000)}\nRetry: ${retry}\nLogs: ${context.log.directory}`,
    );
    if (!skipFailed)
      throw context.failure(
        new ApiError(
          error instanceof ApiError ? error.code : "IO_ERROR",
          `${message.slice(0, 1000)}\nRetry: ${retry}`,
        ),
      );
    return false;
  }
}
