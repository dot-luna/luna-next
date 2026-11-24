import { locked, readDocument, writeFile } from "@/lib/files.ts";
import { validate } from "@/lib/validation.ts";
import { ApiError } from "@/lib/response.ts";
import type { WallpaperContext } from "./context.ts";
import { wallpaperRenderer } from "./runtime.ts";
import { wallpaperSettingsSchema, type WallpaperSettings } from "./schema.ts";

class WallpaperSettingsStore {
  /** Create only missing documents; reads preserve authored JSONC and omitted settings. */
  async read(context: { configFile: string }) {
    const { source, value } = await readDocument(context.configFile);
    return { source, value: validate(wallpaperSettingsSchema, value, context.configFile) };
  }

  /** Read a dot-separated key; missing keys return null rather than renderer defaults. */
  lookup({ settings, key }: { settings: WallpaperSettings; key?: string }): unknown {
    if (key === undefined) return settings;
    if (key.split(".").some((part) => !part))
      throw new ApiError("INVALID_ARGUMENT", "Wallpaper keys use nonempty dot-separated segments");
    let value: unknown = settings;
    for (const part of key.split(".")) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return null;
      value = (value as Record<string, unknown>)[part];
    }
    return value;
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
    for (const group of ["wallpaper", "playback", "transition"] as const)
      if (changes.data[group]) value[group] = { ...previous[group], ...changes.data[group] };
    return validate(wallpaperSettingsSchema, value, "Wallpaper settings");
  }
}

export const wallpaperSettings = new WallpaperSettingsStore();
