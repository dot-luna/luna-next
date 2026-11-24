import { realpath } from "node:fs/promises";
import { isAbsolute, join } from "pathe";
import { locked } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { wallpaperLibrary } from "@/modules/wallpaper/library.ts";
import type { ThemeContext } from "./context.ts";

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
  }: {
    context: ThemeContext;
    root: string;
    sources: string[];
  }) {
    if (!sources.length) return;
    const inputs: string[] = [];
    for (const source of sources) {
      if (/^https?:\/\//iu.test(source)) inputs.push(source);
      else {
        if (isAbsolute(source))
          throw new ApiError("INVALID_PATH", "Theme wallpaper paths must be relative");
        const path = await realpath(join(root, source));
        if (path !== root && !path.startsWith(root + "/"))
          throw new ApiError("INVALID_PATH", "Theme wallpaper escapes its folder");
        inputs.push(path);
      }
    }
    const library = { env: context.env, libraryDir: context.wallpaperDir };
    const path = await wallpaperLibrary.directory({ context: library, create: true });
    await locked({ env: context.env, configFile: join(path, ".library") }, () =>
      wallpaperLibrary.install({ context: library, sources: inputs }),
    );
  }
}

export const themeWallpapers = new ThemeWallpapers();
