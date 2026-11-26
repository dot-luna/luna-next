import { ApiError, type ApiResponse } from "@/lib/response.ts";
import type { InstallContext } from "./command.ts";

export interface InstallFailure {
  app: string;
  code: string;
  error: string;
  /** A shell command that retries only this step. */
  retry: string;
  logDirectory: string;
}

export interface AppInstallResult {
  installed: string[];
  failed: InstallFailure[];
  completed: boolean;
  logDirectory: string;
}

export interface InstallResult {
  repository: string;
  executable: string;
  cliRebuilt: boolean;
  completed: boolean;
  failed: InstallFailure[];
  logDirectory: string;
  installedApps: string[];
  installedWebapps: string[];
  pending: [];
}

export type InstallResponse = ApiResponse<InstallResult>;

export interface UpdateResult {
  repository: string;
  executable: string;
}

export type UpdateResponse = ApiResponse<UpdateResult>;

class InstallReport {
  /** Quote one word for POSIX shells, as printed retry commands and generated shell files need. */
  quote(value: string) {
    return "'" + value.replaceAll("'", "'\\''") + "'";
  }

  /**
   * Run one recoverable step and record its failure in `failed`, the log and progress.
   * Returns false after a recorded failure when skipFailed is set; otherwise throws the
   * failure with its retry command. Required prerequisites should not use this.
   */
  async attempt({
    context,
    app,
    retry,
    skipFailed,
    failed,
    operation,
  }: {
    context: InstallContext;
    app: string;
    retry: string;
    skipFailed: boolean;
    failed: InstallFailure[];
    operation: () => Promise<unknown>;
  }) {
    try {
      await operation();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof ApiError ? error.code : "IO_ERROR";
      const failure = { app, code, error: message, retry, logDirectory: context.log.directory };
      failed.push(failure);
      context.log.failures.push(failure);
      context.log.event({ type: "app-failed", ...failure });
      context.progress(
        `${app} failed: ${message.slice(0, 1000)}\nRetry: ${retry}\nLogs: ${context.log.directory}`,
      );
      if (!skipFailed)
        throw context.failure(new ApiError(code, `${message.slice(0, 1000)}\nRetry: ${retry}`));
      return false;
    }
  }
}

export const installReport = new InstallReport();
