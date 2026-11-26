import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "pathe";
import { environment, lunaConfigHome } from "@/lib/env.ts";
import { canonicalPath, hasControlCharacters } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";
import { locked, readDocument, writeFile } from "@/lib/files.ts";
import { validate } from "@/lib/validation.ts";
import { valueAtKey } from "@/lib/keys.ts";
import { wallpaperRenderer } from "./runtime.ts";
import { wallpaperSettingsSchema, type WallpaperSettings } from "./schema.ts";

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

export interface WallpaperSetOptions extends WallpaperOptions {
  /** Target only SDDM's Login background; the desktop selection stays unchanged. */
  login?: boolean;
  loginConfigFile?: string;
  systemRoot?: string;
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

class WallpaperConfig {
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

  /** Create only missing documents; reads preserve authored JSONC and omitted settings. */
  async read(context: { configFile: string }) {
    const { source, value } = await readDocument(context.configFile);
    return { source, value: validate(wallpaperSettingsSchema, value, context.configFile) };
  }

  /** Read a dot-separated key; missing keys return null rather than renderer defaults. */
  lookup({ settings, key }: { settings: WallpaperSettings; key?: string }): unknown {
    return valueAtKey({ value: settings, key, label: "Wallpaper" });
  }

  /** Publish validated snapshots until closed. Watch parent directories so atomic saves keep working. */
  async follow(context: { configFile: string }, publish: (settings: WallpaperSettings) => void) {
    let subscriptions: FSWatcher[] = [];
    let subscriptionKey = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reading = false;
    let pending = false;
    let stopped = false;

    const close = () => {
      stopped = true;
      clearTimeout(timer);
      for (const subscription of subscriptions) subscription.close();
    };
    const schedule = () => {
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, 100);
    };
    const subscribe = async () => {
      // Follow the authored path and its symlink target; retargeting either must be noticed.
      const targets = [...new Set([context.configFile, await canonicalPath(context.configFile)])];
      const key = JSON.stringify(targets);
      if (key === subscriptionKey || stopped) return;
      const next: FSWatcher[] = [];
      try {
        for (const target of targets) {
          const subscription = watch(dirname(target), (_event, name) => {
            if (name === null || String(name) === basename(target)) schedule();
          });
          subscription.on("error", (error) =>
            console.warn("Luna wallpaper config: " + error.message),
          );
          next.push(subscription);
        }
      } catch (error) {
        for (const subscription of next) subscription.close();
        throw error;
      }
      for (const subscription of subscriptions) subscription.close();
      subscriptions = next;
      subscriptionKey = key;
    };
    const refresh = async () => {
      if (stopped) return;
      if (reading) {
        pending = true;
        return;
      }
      reading = true;
      try {
        await subscribe();
        const { value } = await this.read(context);
        if (!stopped) publish(value);
      } catch (error) {
        // Invalid editor buffers never replace the last valid renderer snapshot.
        console.warn("Luna wallpaper config: " + String(error));
      } finally {
        reading = false;
        if (pending) {
          pending = false;
          schedule();
        }
      }
    };
    try {
      await subscribe();
      await refresh();
      return close;
    } catch (error) {
      close();
      throw error;
    }
  }

  /**
   * Merge supplied groups, save atomically under the config lock, then reload a running renderer.
   * If the reload fails, restore the previous source (refusing to overwrite external edits) and
   * the renderer's previous snapshot; recovery failures are appended to the original error.
   */
  save({ context, patch }: { context: WallpaperContext; patch: unknown }) {
    return locked(context, async () => {
      const previous = await this.read(context);
      const value = this._patch({ previous: previous.value, patch });
      const renderer = await wallpaperRenderer.resolve(context);
      const running = (await wallpaperRenderer.state(renderer)).running;
      const active = running ? await wallpaperRenderer.snapshot(renderer) : null;
      const next = JSON.stringify(value, null, 2) + "\n";
      await writeFile(context.configFile, next, previous.source);
      if (!running) return value;
      try {
        await wallpaperRenderer.reload({ context: renderer, settings: value });
      } catch (error) {
        // An external edit also prevents applying an obsolete recovery snapshot.
        try {
          await writeFile(context.configFile, previous.source, next);
        } catch (recovery) {
          throw new ApiError(
            recovery instanceof ApiError ? recovery.code : "IO_ERROR",
            `${String(error)}; settings recovery: ${String(recovery)}`,
          );
        }
        try {
          if (active !== null)
            await wallpaperRenderer.reload({ context: renderer, settings: active });
        } catch (recovery) {
          throw new ApiError(
            "COMMAND_FAILED",
            `${String(error)}; renderer recovery: ${String(recovery)}`,
          );
        }
        throw error;
      }
      return value;
    });
  }

  /** Merge only supplied groups so changing fit does not erase a source or future settings. */
  private _patch({ previous, patch }: { previous: WallpaperSettings; patch: unknown }) {
    const changes = wallpaperSettingsSchema.safeParse(patch);
    if (!changes.success) throw new ApiError("INVALID_ARGUMENT", changes.error.message);
    const value = { ...previous, ...changes.data };
    for (const group of ["wallpaper", "playback"] as const)
      if (changes.data[group]) value[group] = { ...previous[group], ...changes.data[group] };
    return validate(wallpaperSettingsSchema, value, "Wallpaper settings");
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

export const wallpaperConfig = new WallpaperConfig();
