import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "pathe";
import { environment, lunaConfigHome } from "@/lib/env.ts";
import { metadata } from "@/lib/files.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { quickshell, type QuickshellContext } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";

export interface BarOptions {
  /** Select source QML from this checkout instead of the installed bar. */
  repository?: string;
  /** Explicit JSONC path; relative paths start at the caller's working directory. */
  configFile?: string;
  /** Replaces Bun.env for runtime paths, theme selection, and child processes. */
  env?: Record<string, string>;
}

export interface BarState {
  running: boolean;
  shellDirectory: string;
  configFile: string;
}

/** Enough to read settings; it does not require Quickshell or an installed shell. */
export interface BarSettingsContext {
  env: Record<string, string>;
  configHome: string | undefined;
  configFile: string;
}

/** A Quickshell context scoped to the bar shell; `configFile` is absolute. */
export interface BarContext extends QuickshellContext {
  configFile: string;
}

class BarContextResolver {
  /** Resolve the settings file: configFile, then LUNA_BAR_CONFIG, then bar.jsonc in Luna's config home. */
  settings(options: BarOptions = {}): BarSettingsContext {
    const env = environment(options.env);
    const configHome = lunaConfigHome(env);
    if (configHome && !isAbsolute(configHome))
      throw new ApiError("INVALID_PATH", "Bar configuration home must be absolute");
    const file =
      options.configFile ??
      (env.LUNA_BAR_CONFIG || (configHome ? join(configHome, "bar.jsonc") : undefined));
    if (!file || hasControlCharacters(file) || resolve(file) === "/")
      throw new ApiError("INVALID_PATH", "Set a nonempty bar config file or HOME");
    return { env, configHome, configFile: resolve(file) };
  }

  /** Resolve fresh paths, require the shell's shell.qml, then locate Quickshell. */
  async resolve(options: BarOptions = {}): Promise<BarContext> {
    const { env, configHome, configFile } = this.settings(options);
    const shell = options.repository
      ? join(options.repository, "src/luna-bar/src/shell")
      : configHome
        ? join(configHome, "bar")
        : undefined;
    if (!shell || !isAbsolute(shell) || hasControlCharacters(shell))
      throw new ApiError(
        "INVALID_PATH",
        "The bar requires an absolute configuration or checkout path",
      );
    if (!(await metadata(join(shell, "shell.qml")))?.isFile())
      throw new ApiError("INVALID_PATH", `Bar shell is missing: ${shell}`);
    const executable = quickshell.executable({ env, feature: "Luna's bar" });
    return { env, executable, configFile, shellDirectory: await realpath(shell) };
  }
}

export const barContext = new BarContextResolver();
