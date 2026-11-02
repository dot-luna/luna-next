import { copyFile, link, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { basename, isAbsolute, join } from "pathe";
import { ApiError } from "../lib/response.ts";
import { command, type ThemeContext } from "./context.ts";
import { metadata } from "./files.ts";

/** Import declared media without recursion, replacement, or selecting a wallpaper. */
export async function importWallpapers(context: ThemeContext, root: string, sources: string[]) {
  if (!sources.length) return;
  const targets: { name: string; path?: string; url?: string; directoryMember?: boolean }[] = [];
  for (const source of sources) {
    if (/^https?:\/\//u.test(source)) {
      const url = new URL(source);
      if (url.username || url.password || !url.hostname)
        throw new ApiError("INVALID_ARGUMENT", "Wallpaper URLs must not contain credentials");
      const name = decodeURIComponent(basename(url.pathname));
      if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\"))
        throw new ApiError("INVALID_ARGUMENT", "Wallpaper URLs need a filename");
      targets.push({ name, url: source });
    } else {
      if (isAbsolute(source))
        throw new ApiError("INVALID_PATH", "Theme wallpaper paths must be relative");
      const path = await realpath(join(root, source));
      if (path !== root && !path.startsWith(root + "/"))
        throw new ApiError("INVALID_PATH", "Theme wallpaper escapes its folder");
      if ((await metadata(path))?.isDirectory()) {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          if (entry.isFile())
            targets.push({ name: entry.name, path: join(path, entry.name), directoryMember: true });
        }
      } else targets.push({ name: basename(path), path });
    }
  }
  if (!targets.length) return;
  await mkdir(context.wallpaperDir, { recursive: true });
  const staging = await mkdtemp(join(context.wallpaperDir, ".luna-media-"));
  try {
    let index = 0;
    for (const target of targets) {
      const staged = join(staging, String(index++));
      if (target.url)
        await command(context, [
          "curl",
          "--fail",
          "--location",
          "--silent",
          "--show-error",
          "--proto",
          "=http,https",
          "--proto-redir",
          "=http,https",
          "--max-time",
          "60",
          "--output",
          staged,
          "--",
          target.url,
        ]);
      else await copyFile(target.path!, staged);
      const mime = await command(context, ["file", "--mime-type", "--brief", "--", staged]);
      if (!mime.startsWith("image/") && !mime.startsWith("video/")) {
        if (target.directoryMember) continue;
        throw new ApiError("INVALID_METADATA", `Unsupported wallpaper media: ${target.name}`);
      }
      const destination = join(context.wallpaperDir, target.name);
      try {
        await link(staged, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await metadata(destination);
        if (
          !existing?.isFile() ||
          !Buffer.from(await Bun.file(staged).arrayBuffer()).equals(
            Buffer.from(await Bun.file(destination).arrayBuffer()),
          )
        ) {
          throw new ApiError(
            "CONFLICT",
            `Wallpaper already exists with different content: ${target.name}`,
          );
        }
      }
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
