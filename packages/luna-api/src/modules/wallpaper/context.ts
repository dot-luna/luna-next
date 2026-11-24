import { isAbsolute, join, resolve } from "pathe";
import { environment, lunaConfigHome } from "@/lib/env.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";

export interface WallpaperOptions {
  /** Explicit JSONC file; relative paths use the caller's working directory. */
  configFile?: string;
  /** Stable media library; relative paths use the caller's working directory. */
  libraryDir?: string;
  /** Select source QML instead of the installed renderer. */
  repository?: string;
  /** Replaces Bun.env for paths and renderer processes. */
  env?: Record<string, string>;
}

export interface WallpaperInstallOptions extends WallpaperOptions {
  /** Rename one explicit local file or URL; folders keep each media basename. */
  name?: string;
  recursive?: boolean;
}

export interface WallpaperEntry {
  name: string;
  path: string;
  current: boolean;
}

export interface WallpaperState {
  running: boolean;
  status: "stopped" | "loading" | "ready" | "error";
  shellDirectory: string;
  configFile: string;
}

/**
 * Resolved absolute paths. The library and renderer shell are optional here so operations
 * that do not need them still work without HOME; their owners report the missing path.
 */
export interface WallpaperContext {
  env: Record<string, string>;
  configFile: string;
  libraryDir?: string;
  shellDirectory?: string;
}

class WallpaperContextResolver {
  /** Resolve fresh paths without touching the filesystem; never retain caller settings. */
  resolve(options: WallpaperOptions = {}): WallpaperContext {
    const env = environment(options.env);
    const configHome = lunaConfigHome(env);
    const configFile =
      options.configFile ??
      (env.LUNA_WALLPAPER_CONFIG || (configHome ? join(configHome, "wallpaper.jsonc") : undefined));
    if (!configFile)
      throw new ApiError(
        "INVALID_PATH",
        "Set a wallpaper config file, LUNA_CONFIG_HOME_DIR, XDG_CONFIG_HOME, or HOME",
      );
    if (configHome && !isAbsolute(configHome))
      throw new ApiError("INVALID_PATH", "Wallpaper configuration home must be absolute");
    const dataHome =
      env.LUNA_DATA_HOME_DIR ||
      (env.XDG_DATA_HOME
        ? join(env.XDG_DATA_HOME, "luna")
        : env.HOME
          ? join(env.HOME, ".local/share/luna")
          : undefined);
    if (dataHome && !isAbsolute(dataHome))
      throw new ApiError("INVALID_PATH", "Wallpaper data home must be absolute");
    const libraryDir = options.libraryDir ?? (dataHome ? join(dataHome, "wallpapers") : undefined);
    return {
      env,
      configFile: this._path(configFile),
      libraryDir: libraryDir === undefined ? undefined : this._path(libraryDir),
      shellDirectory: options.repository
        ? this._path(join(options.repository, "src/luna-wallpaper/src/shell"))
        : configHome
          ? this._path(join(configHome, "wallpaper"))
          : undefined,
    };
  }

  private _path(value: string) {
    if (!value || hasControlCharacters(value) || resolve(value) === "/")
      throw new ApiError(
        "INVALID_PATH",
        "Wallpaper paths must be nonempty and cannot be the filesystem root",
      );
    return resolve(value);
  }
}

export const wallpaperContext = new WallpaperContextResolver();
