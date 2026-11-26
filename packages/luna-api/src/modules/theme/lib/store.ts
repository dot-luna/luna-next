import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { basename, join } from "pathe";
import { metadata } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { themeCommand } from "./command.ts";
import type { ThemeContext } from "./context.ts";
import { themePackages } from "./packages.ts";
import { themeNameSchema } from "../schema.ts";
import { themeSelection } from "./selection.ts";
import { themeValues } from "./values.ts";
import { themeWallpapers } from "./wallpapers.ts";

export interface ThemeEntry {
  name: string;
  current: boolean;
}

/** Installed theme folders in the library; callers hold the selection lock for mutations. */
class ThemeStore {
  /** Reject known destination conflicts before callers download remote assets. */
  async check({
    context,
    name,
    force = false,
  }: {
    context: ThemeContext;
    name: string;
    force?: boolean;
  }) {
    const destination = join(context.libraryDir, themeSelection.validName(name));
    const existing = await metadata(destination);
    if (existing && !existing.isDirectory())
      throw new ApiError("INVALID_PATH", "Installed theme must be a regular directory");
    if (existing && !force)
      throw new ApiError("CONFLICT", "Theme already installed; use --force to replace it");
    return { destination, existing };
  }
  /**
   * Copy a validated theme folder into the library and return its installed path.
   * Prerequisite packages and wallpapers are installed before publication. Throws CONFLICT
   * when the theme exists without force or the source changes while copying.
   */
  async install({
    context,
    source: input,
    name,
    force = false,
    manifestSource,
  }: {
    context: ThemeContext;
    source: string;
    /** Defaults to the source folder name. */
    name?: string;
    force?: boolean;
    /** Exact reviewed manifest bytes for a local source. */
    manifestSource?: string;
  }) {
    if (!input) throw new ApiError("INVALID_PATH", "Theme source must be a directory");
    const source = await realpath(input);
    if (!(await metadata(source))?.isDirectory())
      throw new ApiError("INVALID_PATH", "Theme source must be a directory");
    name = themeSelection.validName(name ?? basename(source));
    const manifest = await themeValues.manifest(source);
    const originalText = await readFile(manifest, "utf8");
    if (manifestSource !== undefined && originalText !== manifestSource)
      throw new ApiError("CONFLICT", "Theme manifest changed after inspection");
    const original = themeValues.parse(originalText, manifest);
    themeValues.resolve({ source: original, name });
    await mkdir(context.libraryDir, { recursive: true });
    const library = await realpath(context.libraryDir);
    if (library === source || library.startsWith(source + "/"))
      throw new ApiError("INVALID_PATH", "Theme source cannot contain the library");
    const { destination, existing } = await this.check({
      context: { ...context, libraryDir: library },
      name,
      force,
    });
    const staging = await mkdtemp(join(library, ".luna-theme-"));
    try {
      const staged = join(staging, "theme");
      await this._copyTree({ source, destination: staged, root: source });
      const value = await themeValues.read(staged);
      themeValues.resolve({ source: value, name });
      if ((await readFile(await themeValues.manifest(staged), "utf8")) !== originalText)
        throw new ApiError("CONFLICT", "Theme source changed while copying");
      await themePackages.install({ context, packages: value.packages });
      await themeWallpapers.import({
        context,
        root: staged,
        sources: value.wallpaper?.sources ?? [],
      });
      if (existing) {
        // Linux/coreutils exchange publishes a complete replacement without a delete-first gap.
        // The exchanged previous tree is removed with staging; it is not retained as a backup.
        await themeCommand.run({
          context,
          args: [
            "mv",
            "--exchange",
            "--no-copy",
            "--no-target-directory",
            "--",
            staged,
            destination,
          ],
        });
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

  /** List valid installed theme names in order, marking the selected one. */
  async list(context: ThemeContext): Promise<ThemeEntry[]> {
    const current = (await themeSelection.read(context)).value.theme?.name;
    if (!(await metadata(context.libraryDir))) return [];
    const names: string[] = [];
    for (const entry of await readdir(context.libraryDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !themeNameSchema.safeParse(entry.name).success) continue;
      if (
        (await metadata(join(context.libraryDir, entry.name, "theme.jsonc")))?.isFile() ||
        (await metadata(join(context.libraryDir, entry.name, "theme.json")))?.isFile()
      )
        names.push(entry.name);
    }
    return names.sort().map((name) => ({ name, current: name === current }));
  }

  /**
   * Remove installed themes and return their paths; dryRun only returns them.
   * Every name is checked before anything is removed; the current theme is rejected.
   */
  async remove({
    context,
    names,
    dryRun = false,
  }: {
    context: ThemeContext;
    names: string[];
    dryRun?: boolean;
  }) {
    if (!names.length)
      throw new ApiError("INVALID_ARGUMENT", "Specify at least one installed theme");
    const current = (await themeSelection.read(context)).value.theme?.name;
    const paths: string[] = [];
    for (const name of new Set(names)) {
      if (name === current)
        throw new ApiError(
          "INVALID_ARGUMENT",
          "Select another theme before removing the current one",
        );
      paths.push(await themeSelection.path({ context, name }));
    }
    if (!dryRun) for (const path of paths) await rm(path, { recursive: true });
    return paths;
  }

  /** Copy directories recursively; every file must resolve to a regular file inside root. */
  private async _copyTree({
    source,
    destination,
    root,
  }: {
    source: string;
    destination: string;
    root: string;
  }) {
    await mkdir(destination);
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const path = join(source, entry.name);
      const target = join(destination, entry.name);
      if (entry.isDirectory()) await this._copyTree({ source: path, destination: target, root });
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
}

export const themeStore = new ThemeStore();
