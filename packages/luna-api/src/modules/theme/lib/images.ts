import { readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "pathe";
import { capture } from "@/lib/process.ts";
import { ApiError } from "@/lib/response.ts";
import type { ThemeContext } from "./context.ts";
import type { ResolvedTheme } from "../schema.ts";
import { themeSelection } from "./selection.ts";

class ThemeImages {
  /** First declared local image; folders are shallow and sorted, imported URLs use the media library. */
  async first({ context, theme }: { context: ThemeContext; theme: ResolvedTheme }) {
    for (const source of theme.wallpaper.sources) {
      let candidate: string;
      if (/^https?:\/\//iu.test(source)) {
        const name = decodeURIComponent(basename(new URL(source).pathname));
        if (!name || name.includes("/") || name.includes("\\"))
          throw new ApiError("INVALID_PATH", "Invalid theme wallpaper filename");
        candidate = join(context.wallpaperDir, name);
      } else {
        const directory = await realpath(await themeSelection.path({ context, name: theme.name }));
        candidate = await realpath(join(directory, source));
        if (
          isAbsolute(source) ||
          (candidate !== directory && !candidate.startsWith(directory + "/"))
        )
          throw new ApiError("INVALID_PATH", "Theme wallpaper must stay inside its theme folder");
      }
      const paths = (await stat(candidate)).isDirectory()
        ? (await readdir(candidate)).sort().map((name) => join(candidate, name))
        : [candidate];
      for (const path of paths) {
        if (!(await stat(path)).isFile()) continue;
        if (await this.isImage({ context, path })) return path;
      }
    }
  }

  async isImage({ context, path }: { context: ThemeContext; path: string }) {
    const result = await capture({
      args: ["file", "--brief", "--mime-type", "--", path],
      env: context.env,
    });
    if (result.code !== 0)
      throw new ApiError(
        "COMMAND_FAILED",
        result.stderr || "Could not inspect the theme wallpaper",
      );
    return result.stdout.trim().startsWith("image/");
  }
}

export const themeImages = new ThemeImages();
