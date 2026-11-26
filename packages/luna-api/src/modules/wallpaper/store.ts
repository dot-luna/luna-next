import { randomInt } from "node:crypto";
import { rm } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "pathe";
import { locked, metadata } from "@/lib/files.ts";
import { canonicalPath, overlaps } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";
import type { WallpaperContext, WallpaperEntry, WallpaperInstallOptions } from "./context.ts";
import { wallpaperLibrary, type LibraryContext } from "./library.ts";
import { wallpaperMedia } from "./media.ts";
import { wallpaperRenderer } from "./runtime.ts";
import { wallpaperImportSchema } from "./schema.ts";
import { wallpaperSettings } from "./settings.ts";

/** Library operations that read or change the saved selection. */
class WallpaperStore {
  async current(context: WallpaperContext) {
    return (await wallpaperSettings.read(context)).value.wallpaper?.source || null;
  }

  /** Copy validated media into the library without changing the selection. */
  async install({
    context,
    source,
    options,
  }: {
    context: WallpaperContext;
    source: string | string[];
    options: WallpaperInstallOptions;
  }) {
    const parsed = wallpaperImportSchema.safeParse({
      sources: typeof source === "string" ? [source] : source,
      name: options.name,
      recursive: options.recursive,
    });
    if (!parsed.success) throw new ApiError("INVALID_ARGUMENT", parsed.error.message);
    return this._libraryLocked(context, async (library) => {
      const current = await this._canonicalSource(await this.current(context));
      const paths = await wallpaperLibrary.install({ context: library, ...parsed.data });
      return this._entries({ paths, current });
    });
  }

  async list(context: WallpaperContext) {
    const media = await wallpaperLibrary.list(this._library(context));
    const current = await this._canonicalSource(await this.current(context));
    return this._entries({ paths: media.map((entry) => entry.path), current });
  }

  /** Return the library directory, or one installed file's path when `name` is given. */
  async path({ context, name }: { context: WallpaperContext; name?: string }) {
    const library = this._library(context);
    return name === undefined
      ? wallpaperLibrary.directory({ context: library })
      : wallpaperLibrary.path({ context: library, name });
  }

  /** Installed names use the shared data library; explicit absolute paths and empty sources remain supported. */
  async select({ context, source }: { context: WallpaperContext; source: string }) {
    if (source === "" || isAbsolute(source))
      return wallpaperSettings.save({ context, patch: { wallpaper: { source } } });
    return this._libraryLocked(context, async (library) => {
      const path = await wallpaperLibrary.path({ context: library, name: source });
      await wallpaperMedia.validate({ context: library, path });
      return wallpaperSettings.save({ context, patch: { wallpaper: { source: path } } });
    });
  }

  /** Select another installed file at random; the current one is reused only when it is alone. */
  random(context: WallpaperContext) {
    return this._libraryLocked(context, async (library) => {
      const all = await wallpaperLibrary.list(library);
      if (!all.length)
        throw new ApiError("INVALID_ARGUMENT", "Install a wallpaper before selecting one randomly");
      const current = await this._canonicalSource(await this.current(context));
      const alternatives = all.filter((entry) => entry.path !== current);
      const choices = alternatives.length ? alternatives : all;
      return wallpaperSettings.save({
        context,
        patch: { wallpaper: { source: choices[randomInt(choices.length)]!.path } },
      });
    });
  }

  /** Validate the complete batch and protect saved and live selections before deleting any managed files. */
  remove({
    context,
    names,
    dryRun = false,
  }: {
    context: WallpaperContext;
    names: string[];
    dryRun?: boolean;
  }) {
    return this._libraryLocked(context, (library) =>
      locked(context, async () => {
        if (
          !Array.isArray(names) ||
          !names.length ||
          names.some((name) => typeof name !== "string")
        )
          throw new ApiError("INVALID_ARGUMENT", "Specify at least one installed wallpaper name");
        const paths: string[] = [];
        for (const name of new Set(names)) {
          const path = await wallpaperLibrary.path({ context: library, name });
          await wallpaperMedia.validate({ context: library, path });
          paths.push(path);
        }
        const selected = await this._canonicalSource(await this.current(context));
        const active = await this._canonicalSource(await wallpaperRenderer.activeSource(context));
        if (paths.some((path) => path === selected || path === active))
          throw new ApiError(
            "INVALID_ARGUMENT",
            "Select and apply another wallpaper before removing selected or playing media",
          );
        if (!dryRun) for (const path of paths) await rm(path);
        return paths;
      }),
    );
  }

  private _library(context: WallpaperContext): LibraryContext {
    if (!context.libraryDir)
      throw new ApiError(
        "INVALID_PATH",
        "Set a wallpaper library directory, LUNA_DATA_HOME_DIR, XDG_DATA_HOME, or HOME",
      );
    return { env: context.env, libraryDir: context.libraryDir };
  }

  /** Hold the library's advisory lock; its lock file must stay a regular file inside the library. */
  private async _libraryLocked<T>(
    context: WallpaperContext,
    operation: (library: LibraryContext) => Promise<T>,
  ) {
    const library = this._library(context);
    const directory = await wallpaperLibrary.directory({ context: library });
    if (overlaps(directory, await canonicalPath(context.configFile)))
      throw new ApiError(
        "INVALID_PATH",
        "Wallpaper configuration must stay outside the media library",
      );
    const lockFile = join(directory, ".library.lock");
    const lock = await metadata(lockFile);
    if (lock && !lock.isFile())
      throw new ApiError("INVALID_PATH", `Wallpaper lock must be a regular file: ${lockFile}`);
    return locked({ configFile: join(directory, ".library"), env: context.env }, () =>
      operation(library),
    );
  }

  /** Compare selections by canonical path; a dangling selected link compares by its resolved path. */
  private async _canonicalSource(source: string | null | undefined) {
    if (!source) return null;
    try {
      return await canonicalPath(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolve(source);
      throw error;
    }
  }

  private _entries({ paths, current }: { paths: string[]; current: string | null }) {
    return paths.map((path): WallpaperEntry => ({
      name: basename(path),
      path,
      current: path === current,
    }));
  }
}

export const wallpaperStore = new WallpaperStore();
