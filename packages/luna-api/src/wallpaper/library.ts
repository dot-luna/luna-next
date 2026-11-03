import { createHash } from "node:crypto";
import { copyFile, link, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "pathe";
import { metadata } from "../lib/files.ts";
import { canonicalPath, ordinaryParents, overlaps } from "../lib/paths.ts";
import { ApiError } from "../lib/response.ts";
import { downloadMedia, mediaExtension, validateMedia, type MediaContext } from "./media.ts";
import { wallpaperNameSchema } from "./schema.ts";

export { validateMedia } from "./media.ts";

export interface LibraryContext extends MediaContext {
  libraryDir: string;
}

export interface MediaInstallOptions {
  recursive?: boolean;
  /** Override the basename of one explicit file or URL. */
  name?: string;
}

function mediaName(name: string) {
  if (!wallpaperNameSchema.safeParse(name).success)
    throw new ApiError("INVALID_ARGUMENT", "Wallpaper names must be ordinary single filenames");
  return name;
}

/** Validate the owned directory before callers create its persistent advisory lock. */
export async function libraryDirectory(context: LibraryContext, create = false) {
  const path = context.libraryDir;
  // oxlint-disable-next-line no-control-regex
  if (!isAbsolute(path) || resolve(path) === "/" || /[\x00-\x1f\x7f]/u.test(path))
    throw new ApiError("INVALID_PATH", "Wallpaper library must be an absolute non-root path");
  await ordinaryParents(join(path, ".entry"));
  if (create) await mkdir(path, { recursive: true });
  return canonicalPath(path);
}

/** Resolve an existing regular library file, never following a filename symlink. */
export async function managedPath(context: LibraryContext, name: string) {
  name = mediaName(name);
  const path = join(await libraryDirectory(context), name);
  if (!(await metadata(path))?.isFile())
    throw new ApiError("INVALID_PATH", `Wallpaper is not installed: ${name}`);
  return path;
}

/** List supported immediate files; locks, staging, directories and symlinks stay private. */
export async function listMedia(context: LibraryContext) {
  const library = await libraryDirectory(context);
  if (!(await metadata(library))) return [];
  const result: { name: string; path: string }[] = [];
  for (const entry of (await readdir(library, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    if (!entry.isFile()) continue;
    try {
      mediaName(entry.name);
      const path = join(library, entry.name);
      await validateMedia(context, path);
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

interface Input {
  name?: string;
  path?: string;
  url?: string;
  directoryMember?: boolean;
}

function remoteInput(input: string): Input | undefined {
  // Reject controls before URL parsing can silently discard them.
  // oxlint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/u.test(input))
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
  if (name) mediaName(name);
  return { name: name || undefined, url: url.href };
}

async function directoryInputs(path: string, recursive: boolean): Promise<Input[]> {
  const inputs: Input[] = [];
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const member = join(path, entry.name);
    if (entry.isFile()) inputs.push({ name: entry.name, path: member, directoryMember: true });
    else if (entry.isDirectory() && recursive)
      inputs.push(...(await directoryInputs(member, true)));
  }
  return inputs;
}

async function digest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}

interface StagedMedia {
  path: string;
  destination: string;
  digest: string;
  size: number;
}

async function sameContent(path: string, media: StagedMedia) {
  const info = await metadata(path);
  return info?.isFile() && info.size === media.size && (await digest(path)) === media.digest;
}

/**
 * Import local files, folder members or HTTP(S) URLs without replacing existing media.
 * Callers hold the library's .library.lock. Validation and conflicts are checked for
 * the complete batch before publication; an I/O failure during publication may leave
 * earlier files installed. Identical basenames with identical bytes are idempotent.
 */
export async function installMedia(
  context: LibraryContext,
  sources: string[],
  options: MediaInstallOptions = {},
): Promise<string[]> {
  if (!sources.length || sources.some((source) => !source.trim()))
    throw new ApiError("INVALID_ARGUMENT", "Specify at least one wallpaper source");
  if (options.name !== undefined) {
    mediaName(options.name);
    if (sources.length !== 1)
      throw new ApiError("INVALID_ARGUMENT", "A wallpaper name requires exactly one file or URL");
  }
  const library = await libraryDirectory(context);
  const inputs: Input[] = [];
  for (const source of sources) {
    const remote = remoteInput(source);
    if (remote) inputs.push(remote);
    else {
      const path = await realpath(source);
      const info = await metadata(path);
      if (overlaps(path, library))
        throw new ApiError("INVALID_PATH", "Wallpaper sources cannot overlap the library");
      if (info?.isDirectory()) {
        if (options.name !== undefined)
          throw new ApiError("INVALID_ARGUMENT", "A wallpaper name cannot rename a folder");
        inputs.push(...(await directoryInputs(path, options.recursive ?? false)));
      } else if (info?.isFile()) inputs.push({ name: basename(source), path });
      else
        throw new ApiError("INVALID_PATH", `Wallpaper source must be a file or folder: ${source}`);
    }
  }
  if (!inputs.length) return [];
  await libraryDirectory(context, true);
  const staging = await mkdtemp(join(library, ".luna-media-"));
  try {
    const targets = new Map<string, StagedMedia>();
    for (const [index, input] of inputs.entries()) {
      const path = join(staging, String(index));
      if (input.url) await downloadMedia(context, input.url, path);
      else await copyFile(input.path!, path);
      let mime: string;
      try {
        mime = await validateMedia(context, path);
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
      const hash = await digest(path);
      const name = mediaName(
        options.name ?? input.name ?? `wallpaper-${hash.slice(0, 16)}.${mediaExtension(mime)}`,
      );
      const destination = join(library, name);
      const media = { path, destination, digest: hash, size: (await metadata(path))!.size };
      const duplicate = targets.get(destination);
      if (duplicate && (duplicate.digest !== media.digest || duplicate.size !== media.size))
        throw new ApiError("CONFLICT", `Wallpaper sources have different content: ${name}`);
      if ((await metadata(destination)) && !(await sameContent(destination, media)))
        throw new ApiError("CONFLICT", `Wallpaper already exists with different content: ${name}`);
      targets.set(destination, media);
    }
    for (const media of targets.values()) {
      try {
        // Hard links publish complete files and cannot replace an existing destination.
        await link(media.path, media.destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (!(await sameContent(media.destination, media)))
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
