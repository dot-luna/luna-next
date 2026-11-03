import { realpath } from "node:fs/promises";
import { isAbsolute, join } from "pathe";
import { locked } from "../lib/files.ts";
import { ApiError } from "../lib/response.ts";
import { installMedia, libraryDirectory } from "../wallpaper/library.ts";
import type { ThemeContext } from "./context.ts";

/** Import confined declared media without recursion or changing wallpaper selection. */
export async function importWallpapers(context: ThemeContext, root: string, sources: string[]) {
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
  const path = await libraryDirectory(library, true);
  await locked({ env: context.env, configFile: join(path, ".library") }, () =>
    installMedia(library, inputs),
  );
}
