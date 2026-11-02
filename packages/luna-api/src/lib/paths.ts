import { realpath } from "node:fs/promises";
import { dirname, join, basename } from "pathe";
import { metadata } from "./files.ts";
import { ApiError } from "./response.ts";

/** Resolve existing ancestors too, so nonexistent destinations cannot hide a symlink alias. */
export async function canonicalPath(path: string): Promise<string> {
  if (await metadata(path)) return realpath(path);
  return join(await canonicalPath(dirname(path)), basename(path));
}

export function overlaps(a: string, b: string) {
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
}

/** Owned exports may replace a leaf link, but must never follow linked parent directories. */
export async function ordinaryParents(path: string) {
  let current = "";
  for (const part of dirname(path).split("/").filter(Boolean)) {
    current += "/" + part;
    const info = await metadata(current);
    if (info && !info.isDirectory())
      throw new ApiError("INVALID_PATH", `Export parent must be an ordinary directory: ${current}`);
  }
}
