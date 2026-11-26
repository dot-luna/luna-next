import { ApiError } from "@/lib/response.ts";
import { wallpaper } from "@/modules/wallpaper/index.ts";
import { themeAppearance } from "./appearance.ts";
import type { ThemeContext } from "./context.ts";
import { themePackages } from "./packages.ts";
import { themeSelection } from "./selection.ts";
import { themeWallpapers } from "./wallpapers.ts";

/** Apply prerequisites, fonts/GTK palette, selection and the first declared wallpaper. No app reloads. */
export async function activateTheme({ context, name }: { context: ThemeContext; name: string }) {
  const value = await themeSelection.inspect({ context, name });
  await themePackages.install({ context, packages: value.packages });
  const paths = await themeWallpapers.import({
    context,
    root: await themeSelection.path({ context, name }),
    sources: value.wallpaper.sources,
    reuseRemote: true,
  });
  await themeAppearance.save({
    context,
    mode: value.colors.mode,
    theme: value,
    apply: async () => {
      if (!paths.length) return;
      const result = await wallpaper.set(paths[0]!, {
        env: context.env,
        libraryDir: context.wallpaperDir,
        configFile: context.wallpaperConfigFile,
      });
      // Wallpaper saves recover their own failed renderer application; the enclosing transaction
      // then recovers theme/GTK state. No fallible work follows a successful wallpaper save.
      if (!result.succes) throw new ApiError(result.err, result.errMessage);
    },
  });
  return value;
}
