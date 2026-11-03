import { isAbsolute, join, resolve } from "pathe";
import { ApiError } from "../lib/response.ts";

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

function path(value: string) {
  // oxlint-disable-next-line no-control-regex
  if (!value || /[\x00-\x1f\x7f]/u.test(value) || resolve(value) === "/")
    throw new ApiError(
      "INVALID_PATH",
      "Wallpaper paths must be nonempty and cannot be the filesystem root",
    );
  return resolve(value);
}

export function wallpaperContext(options: WallpaperOptions = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? Bun.env))
    if (value !== undefined) env[key] = value;
  const configHome =
    env.LUNA_CONFIG_HOME_DIR ||
    (env.XDG_CONFIG_HOME
      ? join(env.XDG_CONFIG_HOME, "luna")
      : env.HOME
        ? join(env.HOME, ".config/luna")
        : undefined);
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
    configFile: path(configFile),
    libraryDir: libraryDir === undefined ? undefined : path(libraryDir),
    shellDirectory: options.repository
      ? path(join(options.repository, "src/luna-wallpaper/src/shell"))
      : configHome
        ? path(join(configHome, "wallpaper"))
        : undefined,
  };
}

export type WallpaperContext = ReturnType<typeof wallpaperContext>;
