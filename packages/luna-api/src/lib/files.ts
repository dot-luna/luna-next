import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "pathe";
import { ApiError } from "./response.ts";

export async function metadata(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function parse(source: string, label: string): unknown {
  try {
    return Bun.JSONC.parse(source);
  } catch (error) {
    throw new ApiError(
      "INVALID_METADATA",
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Create missing JSONC documents as {}, leaving existing bytes and omitted values untouched. */
export async function readDocument(path: string) {
  await mkdir(dirname(path), { recursive: true });
  try {
    const file = await open(path, "wx", 0o600);
    try {
      await file.writeFile("{}\n");
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const source = await readFile(path, "utf8");
  return { source, value: source.trim() ? parse(source, path) : {} };
}

/** Preserve file modes and symlink targets; refuse detected external edits before rename. */
export async function writeFile(path: string, contents: string, expected: string | null) {
  let info = await metadata(path);
  if (info?.isSymbolicLink()) {
    path = await realpath(path);
    info = await metadata(path);
  }
  if ((await readOptional(path)) !== expected)
    throw new ApiError("CONFLICT", `File changed externally: ${path}`);
  if (contents === expected) return;
  await mkdir(dirname(path), { recursive: true });
  const staging = await mkdtemp(join(dirname(path), ".luna-write-"));
  try {
    const staged = join(staging, "file");
    const file = await open(staged, "wx", 0o600);
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally {
      await file.close();
    }
    if (info) await chmod(staged, info.mode & 0o777);
    if ((await readOptional(path)) !== expected)
      throw new ApiError("CONFLICT", `File changed externally: ${path}`);
    await rename(staged, path);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** A child holds the advisory lock until its stdin closes, including after caller exit. */
export async function locked<T>(
  context: { configFile: string; env: Record<string, string> },
  operation: () => Promise<T>,
) {
  await mkdir(dirname(context.configFile), { recursive: true });
  // Keep the lock inode between calls; unlinking it would let concurrent writers bypass it.
  const child = Bun.spawn(
    [
      "flock",
      "--exclusive",
      "--nonblock",
      `${context.configFile}.lock`,
      "bash",
      "-c",
      'printf "locked\\n"; read -r',
    ],
    {
      env: context.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const ready = await child.stdout.getReader().read();
  if (ready.done || !new TextDecoder().decode(ready.value).startsWith("locked")) {
    await child.exited;
    throw new ApiError(
      "CONFLICT",
      "Another operation holds the lock, or flock/Bash is unavailable",
    );
  }
  try {
    return await operation();
  } finally {
    child.stdin.write("done\n");
    child.stdin.end();
    await child.exited;
  }
}
