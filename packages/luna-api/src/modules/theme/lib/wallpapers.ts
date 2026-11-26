import { readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join } from "pathe";
import { locked, metadata } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { wallpaperLibrary } from "@/modules/wallpaper/library.ts";
import { wallpaperNameSchema } from "@/modules/wallpaper/schema.ts";
import type { ThemeContext } from "./context.ts";
import { themeRemote } from "./remote.ts";

class ThemeWallpapers {
  /**
   * Import declared media into the wallpaper library without recursion or changing selection.
   * HTTP(S) URLs pass through; relative paths must resolve inside the canonical root,
   * else INVALID_PATH.
   */
  async import({
    context,
    root,
    sources,
    reuseRemote = false,
  }: {
    context: ThemeContext;
    root: string;
    sources: string[];
    /** Activation reuses already imported URL media instead of downloading it again. */
    reuseRemote?: boolean;
  }) {
    if (!sources.length) return [];
    const inputs: string[] = [];
    const cached: string[] = [];
    const order: string[] = [];
    const library = { env: context.env, libraryDir: context.wallpaperDir };
    for (const source of sources) {
      if (/^https?:\/\//iu.test(source)) {
        const name = decodeURIComponent(basename(themeRemote.url(source).pathname));
        if (name && !wallpaperNameSchema.safeParse(name).success)
          throw new ApiError("INVALID_PATH", "Invalid theme wallpaper filename");
        order.push(name);
        const path = join(context.wallpaperDir, name);
        if (reuseRemote && name && (await metadata(path))?.isFile()) {
          await wallpaperLibrary.validate({ context, path });
          cached.push(path);
        } else inputs.push(source);
      } else {
        if (isAbsolute(source))
          throw new ApiError("INVALID_PATH", "Theme wallpaper paths must be relative");
        const path = await realpath(join(root, source));
        if (path !== root && !path.startsWith(root + "/"))
          throw new ApiError("INVALID_PATH", "Theme wallpaper escapes its folder");
        inputs.push(path);
        order.push(
          ...((await metadata(path))?.isDirectory()
            ? (await readdir(path)).sort()
            : [basename(path)]),
        );
      }
    }
    const path = await wallpaperLibrary.directory({ context: library, create: true });
    return locked({ env: context.env, configFile: join(path, ".library") }, async () => {
      const imported = inputs.length
        ? await wallpaperLibrary.install({ context: library, sources: inputs })
        : [];
      return [...new Set([...cached, ...imported])].sort(
        (a, b) => order.indexOf(basename(a)) - order.indexOf(basename(b)),
      );
    });
  }
}

export const themeWallpapers = new ThemeWallpapers();
