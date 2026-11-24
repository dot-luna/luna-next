import { dirname, isAbsolute, join, resolve } from "pathe";
import { environment } from "@/lib/env.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";
import type { InstallLog } from "@/modules/self/install/log.ts";

export interface ThemeOptions {
  /** Replaces Bun.env for path selection and child commands. */
  env?: Record<string, string>;
  configFile?: string;
  libraryDir?: string;
  wallpaperDir?: string;
}

export interface ThemeInstallOptions extends ThemeOptions {
  name?: string;
  force?: boolean;
}

export interface ThemeContext {
  /** Present during self-install, which records child commands in its log. */
  log?: InstallLog;
  env: Record<string, string>;
  /** Selection file holding the chosen theme name and mode. */
  configFile: string;
  /** Directory of installed theme folders. */
  libraryDir: string;
  /** Wallpaper library that receives a theme's declared media on install. */
  wallpaperDir: string;
}

class ThemeContextResolver {
  /** Resolve fresh paths per call without reading or creating files; explicit paths win. */
  resolve(options: ThemeOptions & { log?: InstallLog } = {}): ThemeContext {
    const env = environment(options.env);
    const configFile = this._path(
      options.configFile ??
        join(
          env.LUNA_CONFIG_HOME_DIR || join(this._base({ env, name: "XDG_CONFIG_HOME" }), "luna"),
          "theme.jsonc",
        ),
    );
    const libraryDir = this._path(
      options.libraryDir ??
        join(
          env.LUNA_DATA_HOME_DIR || join(this._base({ env, name: "XDG_DATA_HOME" }), "luna"),
          "themes",
        ),
    );
    return {
      log: options.log,
      env,
      configFile,
      libraryDir,
      wallpaperDir: this._path(options.wallpaperDir ?? join(dirname(libraryDir), "wallpapers")),
    };
  }

  /** Use an XDG base directory, falling back to its HOME default; either must be absolute. */
  private _base({
    env,
    name,
  }: {
    env: Record<string, string>;
    name: "XDG_CONFIG_HOME" | "XDG_DATA_HOME";
  }) {
    const fallback = name === "XDG_CONFIG_HOME" ? ".config" : ".local/share";
    const value = env[name] || (env.HOME ? join(env.HOME, fallback) : undefined);
    if (!value || !isAbsolute(value))
      throw new ApiError("INVALID_PATH", `Set an absolute ${name} or HOME`);
    return value;
  }

  private _path(value: string) {
    if (!value || hasControlCharacters(value) || resolve(value) === "/")
      throw new ApiError(
        "INVALID_PATH",
        "Theme paths must be nonempty and cannot be the filesystem root",
      );
    return resolve(value);
  }
}

export const themeContext = new ThemeContextResolver();
