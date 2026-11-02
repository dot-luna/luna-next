import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, relative } from "pathe";
import { ApiError } from "./response.ts";
import { metadata } from "./files.ts";
import { canonicalPath, overlaps, ordinaryParents } from "./paths.ts";
import type { InstallContext } from "../self/install/command.ts";

export async function copyTree(
  source: string,
  destination: string,
  root = source,
  exclude: string[] = [],
  excludeRoot = source,
): Promise<void> {
  const actual = await realpath(source);
  if (actual !== root && !actual.startsWith(root + "/"))
    throw new ApiError("INVALID_PATH", `Source escapes its tree: ${source}`);
  const info = await stat(source);
  if (info.isDirectory()) {
    if ((await metadata(source))?.isSymbolicLink())
      throw new ApiError("INVALID_PATH", `Directory links cannot be exported: ${source}`);
    await mkdir(destination, { mode: info.mode & 0o777 });
    for (const entry of await readdir(source)) {
      const path = join(source, entry);
      const name = relative(excludeRoot, path);
      if (exclude.some((item) => name === item || name.startsWith(item.replace(/\/$/u, "") + "/")))
        continue;
      await copyTree(path, join(destination, entry), root, exclude, excludeRoot);
    }
    await chmod(destination, info.mode & 0o777);
  } else {
    if ((actual !== root && !actual.startsWith(root + "/")) || !info.isFile())
      throw new ApiError(
        "INVALID_PATH",
        `Source must be a regular file inside its tree: ${source}`,
      );
    await copyFile(actual, destination);
  }
}

/** Stage on the destination filesystem and exchange complete owned exports without backups. */
export async function replaceExport(
  context: InstallContext,
  source: string,
  destination: string,
  root: string,
  exclude: string[] = [],
) {
  await ordinaryParents(destination);
  const actualSource = await realpath(source);
  const actualDestination = join(
    await canonicalPath(dirname(destination)),
    destination.split("/").at(-1)!,
  );
  if (overlaps(actualSource, actualDestination))
    throw new ApiError("INVALID_PATH", "An export cannot overlap its source");
  await mkdir(dirname(destination), { recursive: true });
  const stage = await mkdtemp(join(dirname(destination), ".luna-export-"));
  try {
    const staged = join(stage, "export");
    await copyTree(source, staged, root, exclude);
    const previous = await metadata(destination);
    if (previous)
      await context.execute([
        "mv",
        "--exchange",
        "--no-copy",
        "--no-target-directory",
        "--",
        staged,
        destination,
      ]);
    else await rename(staged, destination);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
