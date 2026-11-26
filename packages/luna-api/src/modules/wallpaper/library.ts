import { createHash } from "node:crypto";
import { copyFile, link, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "pathe";
import { metadata } from "@/lib/files.ts";
import { canonicalPath, hasControlCharacters, ordinaryParents, overlaps } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";
import { wallpaperMedia, type MediaContext } from "./media.ts";
import { wallpaperNameSchema } from "./schema.ts";

export interface LibraryContext extends MediaContext {
  libraryDir: string;
}

interface Input {
  name?: string;
  path?: string;
  url?: string;
  /** Unsupported folder members are skipped; explicit sources are rejected. */
  directoryMember?: boolean;
}

interface StagedMedia {
  path: string;
  destination: string;
  digest: string;
  size: number;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** The managed media directory: regular files only, published without replacing existing media. */
class WallpaperLibrary {
  /** Validate the owned directory before callers create its persistent advisory lock. */
  async directory({ context, create = false }: { context: LibraryContext; create?: boolean }) {
    const path = context.libraryDir;
    if (!isAbsolute(path) || resolve(path) === "/" || hasControlCharacters(path))
      throw new ApiError("INVALID_PATH", "Wallpaper library must be an absolute non-root path");
    await ordinaryParents(join(path, ".entry"));
    if (create) await mkdir(path, { recursive: true });
    return canonicalPath(path);
  }

  /** Resolve an existing regular library file, never following a filename symlink. */
  async path({ context, name }: { context: LibraryContext; name: string }) {
    name = this._name(name);
    const path = join(await this.directory({ context }), name);
    if (!(await metadata(path))?.isFile())
      throw new ApiError("INVALID_PATH", `Wallpaper is not installed: ${name}`);
    return path;
  }

  /** List supported immediate files; locks, staging, directories and symlinks stay private. */
  async list(context: LibraryContext) {
    const library = await this.directory({ context });
    if (!(await metadata(library))) return [];
    const result: { name: string; path: string }[] = [];
    for (const entry of (await readdir(library, { withFileTypes: true })).sort(byName)) {
      if (!entry.isFile()) continue;
      try {
        this._name(entry.name);
        const path = join(library, entry.name);
        await wallpaperMedia.validate({ context, path });
        result.push({ name: entry.name, path });
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          (error.code !== "INVALID_ARGUMENT" && error.code !== "INVALID_METADATA")
        )
          throw error;
      }
    }
    return result;
  }

  /**
   * Import local files, folder members or HTTP(S) URLs without replacing existing media.
   * Callers hold the library's .library.lock. Validation and conflicts are checked for
   * the complete batch before publication; an I/O failure during publication may leave
   * earlier files installed. Identical basenames with identical bytes are idempotent.
   */
  async install({
    context,
    sources,
    name,
    recursive = false,
  }: {
    context: LibraryContext;
    sources: string[];
    /** Override the basename of one explicit file or URL. */
    name?: string;
    recursive?: boolean;
  }): Promise<string[]> {
    if (!sources.length || sources.some((source) => !source.trim()))
      throw new ApiError("INVALID_ARGUMENT", "Specify at least one wallpaper source");
    if (name !== undefined) {
      this._name(name);
      if (sources.length !== 1)
        throw new ApiError("INVALID_ARGUMENT", "A wallpaper name requires exactly one file or URL");
    }
    const library = await this.directory({ context });
    const inputs: Input[] = [];
    for (const source of sources) {
      const remote = this._remoteInput(source);
      if (remote) inputs.push(remote);
      else {
        const path = await realpath(source);
        const info = await metadata(path);
        if (overlaps(path, library))
          throw new ApiError("INVALID_PATH", "Wallpaper sources cannot overlap the library");
        if (info?.isDirectory()) {
          if (name !== undefined)
            throw new ApiError("INVALID_ARGUMENT", "A wallpaper name cannot rename a folder");
          inputs.push(...(await this._directoryInputs({ path, recursive })));
        } else if (info?.isFile()) inputs.push({ name: basename(source), path });
        else
          throw new ApiError(
            "INVALID_PATH",
            `Wallpaper source must be a file or folder: ${source}`,
          );
      }
    }
    if (!inputs.length) return [];
    await this.directory({ context, create: true });
    const staging = await mkdtemp(join(library, ".luna-media-"));
    try {
      const targets = new Map<string, StagedMedia>();
      for (const [index, input] of inputs.entries()) {
        const path = join(staging, String(index));
        if (input.url) await wallpaperMedia.download({ context, url: input.url, path });
        else await copyFile(input.path!, path);
        let mime: string;
        try {
          mime = await wallpaperMedia.validate({ context, path });
        } catch (error) {
          if (error instanceof ApiError && error.code === "INVALID_METADATA") {
            if (input.directoryMember) continue;
            throw new ApiError(
              "INVALID_METADATA",
              `Unsupported wallpaper media: ${input.url ?? input.path}`,
            );
          }
          throw error;
        }
        const hash = await this._digest(path);
        const target = this._name(
          name ?? input.name ?? `wallpaper-${hash.slice(0, 16)}.${wallpaperMedia.extension(mime)}`,
        );
        const destination = join(library, target);
        const media = { path, destination, digest: hash, size: (await metadata(path))!.size };
        const duplicate = targets.get(destination);
        if (duplicate && (duplicate.digest !== media.digest || duplicate.size !== media.size))
          throw new ApiError("CONFLICT", `Wallpaper sources have different content: ${target}`);
        if (
          (await metadata(destination)) &&
          !(await this._sameContent({ path: destination, media }))
        )
          throw new ApiError(
            "CONFLICT",
            `Wallpaper already exists with different content: ${target}`,
          );
        targets.set(destination, media);
      }
      for (const media of targets.values()) {
        try {
          // Hard links publish complete files and cannot replace an existing destination.
          await link(media.path, media.destination);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (!(await this._sameContent({ path: media.destination, media })))
            throw new ApiError(
              "CONFLICT",
              `Wallpaper destination changed: ${basename(media.destination)}`,
            );
        }
      }
      return [...targets.keys()];
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  private _name(name: string) {
    if (!wallpaperNameSchema.safeParse(name).success)
      throw new ApiError("INVALID_ARGUMENT", "Wallpaper names must be ordinary single filenames");
    return name;
  }

  /** Return undefined for local paths; URLs must be credential-free HTTP(S). */
  private _remoteInput(input: string): Input | undefined {
    // Reject controls before URL parsing can silently discard them.
    if (hasControlCharacters(input))
      throw new ApiError("INVALID_ARGUMENT", "Wallpaper sources cannot contain control characters");
    if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(input)) return undefined;
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new ApiError("INVALID_ARGUMENT", "Wallpaper URL is invalid");
    }
    if (!/^https?:$/u.test(url.protocol) || url.username || url.password || !url.hostname)
      throw new ApiError("INVALID_ARGUMENT", "Wallpaper URLs must use HTTP(S) without credentials");
    let name: string;
    try {
      name = decodeURIComponent(basename(url.pathname));
    } catch {
      throw new ApiError("INVALID_ARGUMENT", "Wallpaper URL filename has invalid encoding");
    }
    if (name) this._name(name);
    return { name: name || undefined, url: url.href };
  }

  /** Folder members are imported in name order; symlinks and special files are ignored. */
  private async _directoryInputs({
    path,
    recursive,
  }: {
    path: string;
    recursive: boolean;
  }): Promise<Input[]> {
    const inputs: Input[] = [];
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(byName)) {
      const member = join(path, entry.name);
      if (entry.isFile()) inputs.push({ name: entry.name, path: member, directoryMember: true });
      else if (entry.isDirectory() && recursive)
        inputs.push(...(await this._directoryInputs({ path: member, recursive })));
    }
    return inputs;
  }

  private async _digest(path: string) {
    const hash = createHash("sha256");
    for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
    return hash.digest("hex");
  }

  private async _sameContent({ path, media }: { path: string; media: StagedMedia }) {
    const info = await metadata(path);
    return (
      info?.isFile() && info.size === media.size && (await this._digest(path)) === media.digest
    );
  }
}

export const wallpaperLibrary = new WallpaperLibrary();
