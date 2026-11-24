import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "pathe";
import { environment, lunaConfigHome } from "@/lib/env.ts";
import { metadata } from "@/lib/files.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { quickshell, type QuickshellContext } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";

export interface NotifyOptions {
  /** Select source QML from this checkout instead of the installed toast provider. */
  repository?: string;
  /** Explicit JSONC path; relative paths start at the caller's working directory. */
  configFile?: string;
  /** Replaces Bun.env for runtime paths, theme selection, and child processes. */
  env?: Record<string, string>;
}

export interface NotifyState {
  running: boolean;
  shellDirectory: string;
  configFile: string;
}

/** Enough to read settings; it does not require Quickshell or an installed shell. */
export interface NotifySettingsContext {
  env: Record<string, string>;
  configHome: string | undefined;
  configFile: string;
}

/** A Quickshell context scoped to the notify shell; `configFile` is absolute. */
export interface NotifyContext extends QuickshellContext {
  configFile: string;
}

class NotifyContextResolver {
  /** Resolve the settings file: configFile, then LUNA_NOTIFY_CONFIG, then notify.jsonc in Luna's config home. */
  settings(options: NotifyOptions = {}): NotifySettingsContext {
    const env = environment(options.env);
    const configHome = lunaConfigHome(env);
    if (configHome && !isAbsolute(configHome))
      throw new ApiError("INVALID_PATH", "Notification configuration home must be absolute");
    const file =
      options.configFile ??
      (env.LUNA_NOTIFY_CONFIG || (configHome ? join(configHome, "notify.jsonc") : undefined));
    if (!file || hasControlCharacters(file) || resolve(file) === "/")
      throw new ApiError("INVALID_PATH", "Set a nonempty notification config file or HOME");
    return { env, configHome, configFile: resolve(file) };
  }

  /**
   * Resolve the shell from the checkout or the installed copy, then find Quickshell.
   * Fails with INVALID_PATH when shell.qml is missing and COMMAND_FAILED without Quickshell.
   */
  async resolve(options: NotifyOptions = {}): Promise<NotifyContext> {
    const { env, configHome, configFile } = this.settings(options);
    const shell = options.repository
      ? join(options.repository, "src/luna-notify/src/shell")
      : configHome
        ? join(configHome, "notify")
        : undefined;
    if (!shell || !isAbsolute(shell) || hasControlCharacters(shell))
      throw new ApiError(
        "INVALID_PATH",
        "Notifications require an absolute configuration or checkout path",
      );
    if (!(await metadata(join(shell, "shell.qml")))?.isFile())
      throw new ApiError("INVALID_PATH", `Notify shell is missing: ${shell}`);
    const executable = quickshell.executable({ env, feature: "Luna notifications" });
    return { env, executable, configFile, shellDirectory: await realpath(shell) };
  }
}

export const notifyContext = new NotifyContextResolver();
