import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "pathe";
import { parse } from "../lib/files.ts";
import { validate } from "../lib/validation.ts";
import { ApiError } from "../lib/response.ts";
import { wallpaperSettingsSchema, type WallpaperSettings } from "./schema.ts";

/** Create only missing documents; reads preserve authored JSONC and omitted settings. */
export async function readSettings(context: { configFile: string }) {
  await mkdir(dirname(context.configFile), { recursive: true });
  try {
    const file = await open(context.configFile, "wx", 0o600);
    try {
      await file.writeFile("{}\n");
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const source = await readFile(context.configFile, "utf8");
  const value = source.trim() ? parse(source, context.configFile) : {};
  return { source, value: validate(wallpaperSettingsSchema, value, context.configFile) };
}

export function lookup(settings: WallpaperSettings, key?: string): unknown {
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

/** Merge only supplied groups so changing fit does not erase a source or future settings. */
export function patchSettings(previous: WallpaperSettings, patch: unknown) {
  const changes = wallpaperSettingsSchema.safeParse(patch);
  if (!changes.success) throw new ApiError("INVALID_ARGUMENT", changes.error.message);
  const value = { ...previous, ...changes.data };
  for (const group of ["wallpaper", "playback", "transition"] as const)
    if (changes.data[group]) value[group] = { ...previous[group], ...changes.data[group] };
  return validate(wallpaperSettingsSchema, value, "Wallpaper settings");
}
