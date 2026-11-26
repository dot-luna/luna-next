import { readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "pathe";
import { capture } from "@/lib/process.ts";
import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import { themeContext } from "@/modules/theme/context.ts";
import { themeSelection } from "@/modules/theme/selection.ts";
import { loginDefaults } from "./defaults.ts";
import { loginSettings } from "./settings.ts";
import { loginSettingsSchema } from "./schema.ts";

class LoginTemplate {
  /** Snapshot the selected theme and its first image; explicit template tokens win. Video-only themes use a solid background. */
  async resolve({ template, env }: { template: unknown; env?: Record<string, string> }) {
    const authored = validate(loginSettingsSchema, template, "Login template");
    const context = themeContext.resolve({ env });
    const theme = await themeSelection.current(context);
    const colors = Object.fromEntries(
      Object.entries(loginDefaults.theme.colors).map(([key, fallback]) => [
        key,
        theme.colors[key] ?? fallback,
      ]),
    );
    let background: string | undefined;
    for (const source of authored.background?.path ? [] : theme.wallpaper.sources) {
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
        const result = await capture({
          args: ["file", "--brief", "--mime-type", "--", path],
          env: context.env,
        });
        if (result.code !== 0)
          throw new ApiError(
            "COMMAND_FAILED",
            result.stderr || "Could not inspect the theme wallpaper",
          );
        if (result.stdout.trim().startsWith("image/")) {
          background = path;
          break;
        }
      }
      if (background) break;
    }
    return loginSettings.patch({
      previous: {
        theme: {
          colors,
          fonts: { ui: theme.fonts.ui },
          appearance: { rounding: theme.appearance.rounding, blur: theme.appearance.blur },
        },
        background: background ? { path: background } : {},
        login: loginDefaults.login,
      },
      patch: authored,
    });
  }
}
export const loginTemplate = new LoginTemplate();
