import { copyFile, mkdir, mkdtemp, readdir, realpath, rename, rm } from "node:fs/promises";
import { basename, join } from "pathe";
import { ApiError } from "../lib/response.ts";
import { command, type ThemeContext } from "./context.ts";
import { metadata } from "./files.ts";
import { themeNameSchema, validateName } from "./schema.ts";
import { selection, themePath } from "./selection.ts";
import type { ThemeEntry } from "./types.ts";
import { readTheme, resolveTheme } from "./values.ts";
import { importWallpapers } from "./wallpapers.ts";

async function copyTree(source: string, destination: string, root: string) {
  await mkdir(destination);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const path = join(source, entry.name);
    const target = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(path, target, root);
    else {
      const actual = await realpath(path);
      if (!actual.startsWith(root + "/") || !(await metadata(actual))?.isFile())
        throw new ApiError(
          "INVALID_PATH",
          `Theme sources must be files inside their folder: ${path}`,
        );
      await copyFile(actual, target);
    }
  }
}

export async function installTheme(
  context: ThemeContext,
  input: string,
  name?: string,
  force = false,
) {
  if (!input) throw new ApiError("INVALID_PATH", "Theme source must be a directory");
  const source = await realpath(input);
  if (!(await metadata(source))?.isDirectory())
    throw new ApiError("INVALID_PATH", "Theme source must be a directory");
  name = validateName(name ?? basename(source));
  const original = await readTheme(source);
  resolveTheme(original, name);
  await mkdir(context.libraryDir, { recursive: true });
  const library = await realpath(context.libraryDir);
  if (library === source || library.startsWith(source + "/"))
    throw new ApiError("INVALID_PATH", "Theme source cannot contain the library");
  const destination = join(library, name);
  const existing = await metadata(destination);
  if (existing && !existing.isDirectory())
    throw new ApiError("INVALID_PATH", "Installed theme must be a regular directory");
  if (existing && !force)
    throw new ApiError("CONFLICT", "Theme already installed; use --force to replace it");
  const staging = await mkdtemp(join(library, ".luna-theme-"));
  try {
    const staged = join(staging, "theme");
    await copyTree(source, staged, source);
    const value = await readTheme(staged);
    resolveTheme(value, name);
    if (JSON.stringify(value) !== JSON.stringify(original))
      throw new ApiError("CONFLICT", "Theme source changed while copying");
    await importWallpapers(context, staged, value.wallpaper?.sources ?? []);
    if (existing) {
      // Linux/coreutils exchange publishes a complete replacement without a delete-first gap.
      // The exchanged previous tree is removed with staging; it is not retained as a backup.
      await command(context, [
        "mv",
        "--exchange",
        "--no-copy",
        "--no-target-directory",
        "--",
        staged,
        destination,
      ]);
    } else {
      if (await metadata(destination))
        throw new ApiError("CONFLICT", "Theme destination appeared during installation");
      await rename(staged, destination);
    }
    return destination;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function listThemes(context: ThemeContext): Promise<ThemeEntry[]> {
  const current = (await selection(context)).value.theme?.name;
  if (!(await metadata(context.libraryDir))) return [];
  const names: string[] = [];
  for (const entry of await readdir(context.libraryDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !themeNameSchema.safeParse(entry.name).success) continue;
    if ((await metadata(join(context.libraryDir, entry.name, "theme.jsonc")))?.isFile())
      names.push(entry.name);
  }
  return names.sort().map((name) => ({ name, current: name === current }));
}

export async function removeThemes(context: ThemeContext, names: string[], dryRun = false) {
  if (!names.length) throw new ApiError("INVALID_ARGUMENT", "Specify at least one installed theme");
  const current = (await selection(context)).value.theme?.name;
  const paths: string[] = [];
  for (const name of new Set(names)) {
    if (name === current)
      throw new ApiError(
        "INVALID_ARGUMENT",
        "Select another theme before removing the current one",
      );
    paths.push(await themePath(context, name));
  }
  if (!dryRun) for (const path of paths) await rm(path, { recursive: true });
  return paths;
}
