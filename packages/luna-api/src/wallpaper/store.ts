import { randomInt } from "node:crypto";
import { rm } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "pathe";
import { locked, metadata } from "../lib/files.ts";
import { canonicalPath, overlaps } from "../lib/paths.ts";
import { ApiError } from "../lib/response.ts";
import type { WallpaperContext, WallpaperEntry, WallpaperInstallOptions } from "./context.ts";
import {
  installMedia,
  libraryDirectory,
  listMedia,
  managedPath,
  validateMedia,
  type LibraryContext,
} from "./library.ts";
import { wallpaperImportSchema } from "./schema.ts";
import { readSettings } from "./settings.ts";
import { saveSettings } from "./selection.ts";
import { rendererContext, snapshot, state } from "./runtime.ts";

function libraryContext(context: WallpaperContext): LibraryContext {
  if (!context.libraryDir)
    throw new ApiError(
      "INVALID_PATH",
      "Set a wallpaper library directory, LUNA_DATA_HOME_DIR, XDG_DATA_HOME, or HOME",
    );
  return { env: context.env, libraryDir: context.libraryDir };
}

async function libraryLocked<T>(
  context: WallpaperContext,
  operation: (library: LibraryContext) => Promise<T>,
) {
  const library = libraryContext(context);
  const directory = await libraryDirectory(library);
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

export async function currentWallpaper(context: WallpaperContext) {
  return (await readSettings(context)).value.wallpaper?.source || null;
}

async function canonicalSource(source: string | null | undefined) {
  if (!source) return null;
  try {
    return await canonicalPath(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolve(source);
    throw error;
  }
}

async function entries(context: WallpaperContext, paths: string[]): Promise<WallpaperEntry[]> {
  const current = await canonicalSource(await currentWallpaper(context));
  return paths.map((path) => ({ name: basename(path), path, current: path === current }));
}

export async function installWallpapers(
  context: WallpaperContext,
  input: string | string[],
  options: WallpaperInstallOptions,
) {
  const parsed = wallpaperImportSchema.safeParse({
    sources: typeof input === "string" ? [input] : input,
    name: options.name,
    recursive: options.recursive,
  });
  if (!parsed.success) throw new ApiError("INVALID_ARGUMENT", parsed.error.message);
  return libraryLocked(context, async (library) => {
    const current = await canonicalSource(await currentWallpaper(context));
    const paths = await installMedia(library, parsed.data.sources, parsed.data);
    return paths.map((path) => ({ name: basename(path), path, current: path === current }));
  });
}

export async function listWallpapers(context: WallpaperContext) {
  return entries(
    context,
    (await listMedia(libraryContext(context))).map((entry) => entry.path),
  );
}

export async function wallpaperPath(context: WallpaperContext, name?: string) {
  const library = libraryContext(context);
  return name === undefined ? libraryDirectory(library) : managedPath(library, name);
}

/** Installed names use the shared data library; explicit absolute paths and empty sources remain supported. */
export async function selectWallpaper(context: WallpaperContext, input: string) {
  if (input === "" || isAbsolute(input))
    return saveSettings(context, { wallpaper: { source: input } });
  return libraryLocked(context, async (library) => {
    const path = await managedPath(library, input);
    await validateMedia(library, path);
    return saveSettings(context, { wallpaper: { source: path } });
  });
}

export function randomWallpaper(context: WallpaperContext) {
  return libraryLocked(context, async (library) => {
    const all = await listMedia(library);
    if (!all.length)
      throw new ApiError("INVALID_ARGUMENT", "Install a wallpaper before selecting one randomly");
    const current = await canonicalSource(await currentWallpaper(context));
    const alternatives = all.filter((entry) => entry.path !== current);
    const choices = alternatives.length ? alternatives : all;
    return saveSettings(context, {
      wallpaper: { source: choices[randomInt(choices.length)]!.path },
    });
  });
}

/** Detect an installed renderer without making offline library operations depend on Quickshell. */
async function activeSource(context: WallpaperContext) {
  if (
    !context.shellDirectory ||
    !(await metadata(join(context.shellDirectory, "shell.qml")))?.isFile() ||
    !(
      Bun.which("qs", { PATH: context.env.PATH }) ??
      Bun.which("quickshell", { PATH: context.env.PATH })
    )
  )
    return null;
  const renderer = await rendererContext(context);
  return (await state(renderer)).running ? (await snapshot(renderer))?.wallpaper?.source : null;
}

/** Validate the complete batch and protect saved and live selections before deleting any managed files. */
export function removeWallpapers(context: WallpaperContext, names: string[], dryRun = false) {
  return libraryLocked(context, (library) =>
    locked(context, async () => {
      if (!Array.isArray(names) || !names.length || names.some((name) => typeof name !== "string"))
        throw new ApiError("INVALID_ARGUMENT", "Specify at least one installed wallpaper name");
      const paths: string[] = [];
      for (const name of new Set(names)) {
        const path = await managedPath(library, name);
        await validateMedia(library, path);
        paths.push(path);
      }
      const selected = await canonicalSource(await currentWallpaper(context));
      const active = await canonicalSource(await activeSource(context));
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
