import { $ } from "bun";
import { dirname, isAbsolute, join, relative, resolve } from "pathe";
import { ApiError } from "./response.ts";

export interface FileEntry {
  kind: "file" | "directory" | "symlink" | "special";
  mode: number;
}

/** Bun.stat follows links; test the link itself first, including dangling links. */
export async function entry(path: string): Promise<FileEntry | null> {
  if ((await $`test -L ${path}`.quiet().nothrow()).exitCode === 0) return { kind: "symlink", mode: 0 };
  try {
    const stat = await Bun.file(path).stat();
    return { kind: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "special", mode: stat.mode };
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
}

export function within(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith("../"));
}

export function childPath(root: string, path: string, allowRoot = false): string {
  const result = resolve(root, path);
  if (!path || isAbsolute(path) || path.split(/[\\/]/u).includes("..")
    || /[\x00-\x1f\x7f]/u.test(path) || !within(root, result) || (!allowRoot && result === root)) {
    throw new ApiError("INVALID_PATH", `Path must stay inside ${root}: ${path}`);
  }
  return result;
}

/** Reject symlinks and special files in existing ancestors before reading or replacing. */
export async function safePath(path: string): Promise<void> {
  const absolute = resolve(path);
  let current = dirname(absolute);
  const paths = [absolute];
  while (current !== dirname(current)) {
    paths.push(current);
    current = dirname(current);
  }
  for (const item of paths.reverse()) {
    const stat = await entry(item);
    if (stat && stat.kind !== "file" && stat.kind !== "directory") {
      throw new ApiError("INVALID_PATH", `Expected an ordinary file or directory: ${item}`);
    }
  }
}

export async function readJson(path: string): Promise<unknown> {
  await safePath(path);
  const text = await Bun.file(path).text();
  try { return JSON.parse(text); }
  catch {
    throw new ApiError("INVALID_JSON", `Expected JSON content in ${path}; HOCON is not supported by this API.`);
  }
}

/** Directory and rename operations use Bun Shell and the Linux coreutils tools. */
export async function makeDirectory(path: string): Promise<void> {
  await $`/usr/bin/mkdir -p -- ${path}`.quiet();
}

export async function temporaryDirectory(parent: string): Promise<string> {
  await makeDirectory(parent);
  return (await $`mktemp -d -- ${join(parent, ".luna-XXXXXX")}`.text()).trim();
}

export async function remove(path: string): Promise<void> {
  await $`/usr/bin/rm -rf -- ${path}`.quiet();
}

export async function rename(source: string, target: string): Promise<void> {
  await $`/usr/bin/mv -fT -- ${source} ${target}`.quiet();
}

/** Replace a file by rename. With expected contents, reject detected external edits. */
export async function writeFile(path: string, text: string, expected?: string | null): Promise<void> {
  await safePath(path);
  const stage = await temporaryDirectory(dirname(path));
  try {
    const previous = await entry(path);
    const temporary = join(stage, "file");
    await Bun.write(temporary, text, { mode: previous ? previous.mode & 0o777 : 0o600 });
    await $`sync -f -- ${temporary}`.quiet();
    await safePath(path);
    if (expected !== undefined) {
      const current = await entry(path) ? await Bun.file(path).text() : null;
      if (current !== expected) throw new ApiError("CONFLICT", `File changed while preparing its update: ${path}`);
    }
    await rename(temporary, path);
  } finally { await remove(stage); }
}

/** Serialize Luna mutations per app across processes. A crashed owner leaves a busy lock. */
export async function withLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  await safePath(path);
  await makeDirectory(dirname(path));
  const acquired = await $`/usr/bin/mkdir -- ${path}`.quiet().nothrow();
  if (acquired.exitCode !== 0) {
    if (await entry(path)) throw new ApiError("BUSY", `App operation already locked: ${path}`);
    throw new ApiError("IO_ERROR", `Cannot create app lock: ${path}`);
  }
  try { return await operation(); }
  finally { await $`rmdir -- ${path}`.quiet(); }
}
