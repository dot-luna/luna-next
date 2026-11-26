import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "pathe";
import { environment, lunaConfigHome } from "@/lib/env.ts";
import { metadata } from "@/lib/files.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { quickshell, type QuickshellContext } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";

export interface PolkitOptions {
  /** Select source QML from this checkout instead of the installed authentication agent. */
  repository?: string;
  /** Explicit JSONC path; relative paths start at the caller's working directory. */
  configFile?: string;
  /** Replaces Bun.env for runtime paths, theme selection, and child processes. */
  env?: Record<string, string>;
}

export interface PolkitState {
  running: boolean;
  status: "running" | "unavailable" | "stopped";
  shellDirectory: string;
  configFile: string;
}

/** Enough to read settings; it does not require Quickshell or an installed shell. */
export interface PolkitSettingsContext {
  env: Record<string, string>;
  configHome: string | undefined;
  configFile: string;
}

/** A Quickshell context scoped to the polkit shell; `configFile` is absolute. */
export interface PolkitContext extends QuickshellContext {
  configFile: string;
}

class PolkitContextResolver {
  /** Resolve the settings file: configFile, then LUNA_POLKIT_CONFIG, then polkit.jsonc in Luna's config home. */
  settings(options: PolkitOptions = {}): PolkitSettingsContext {
    const env = environment(options.env);
    const configHome = lunaConfigHome(env);
    if (configHome && !isAbsolute(configHome))
      throw new ApiError("INVALID_PATH", "Polkit configuration home must be absolute");
    const file =
      options.configFile ??
      (env.LUNA_POLKIT_CONFIG || (configHome ? join(configHome, "polkit.jsonc") : undefined));
    if (!file || hasControlCharacters(file) || resolve(file) === "/")
      throw new ApiError("INVALID_PATH", "Set a nonempty polkit config file or HOME");
    return { env, configHome, configFile: resolve(file) };
  }

  /**
   * Resolve the shell from the checkout or the installed copy, then find Quickshell.
   * Fails with INVALID_PATH when shell.qml is missing and COMMAND_FAILED without Quickshell.
   */
  async resolve(options: PolkitOptions = {}): Promise<PolkitContext> {
    const { env, configHome, configFile } = this.settings(options);
    const shell = options.repository
      ? join(options.repository, "src/luna-polkit/src/shell")
      : configHome
        ? join(configHome, "polkit")
        : undefined;
    if (!shell || !isAbsolute(shell) || hasControlCharacters(shell))
      throw new ApiError(
        "INVALID_PATH",
        "Authentication requires an absolute configuration or checkout path",
      );
    if (!(await metadata(join(shell, "shell.qml")))?.isFile())
      throw new ApiError("INVALID_PATH", `Polkit shell is missing: ${shell}`);
    const executable = quickshell.executable({ env, feature: "Luna authentication" });
    return { env, executable, configFile, shellDirectory: await realpath(shell) };
  }
}

export const polkitContext = new PolkitContextResolver();
