import { dirname, join, resolve } from "pathe";
import { pathToFileURL } from "node:url";
import { userInfo } from "node:os";
import { metadata } from "@/lib/files.ts";
import { themeContext } from "@/modules/theme/context.ts";
import { themeImages } from "@/modules/theme/images.ts";
import { themeSelection } from "@/modules/theme/selection.ts";
import type { LockContext } from "./context.ts";
import type { LockSettings } from "./schema.ts";

class LockPresentation {
  /** Resolve visual assets once per start/reload; source settings and theme files remain untouched. */
  async theme({ context, settings }: { context: LockContext; settings: LockSettings }) {
    const themePaths = themeContext.resolve({ env: context.env });
    const theme = await themeSelection.current(themePaths);
    let image: string | undefined;
    try {
      if (settings.background?.path) {
        const path = resolve(dirname(context.configFile), settings.background.path);
        if (
          (await metadata(path))?.isFile() &&
          (await themeImages.isImage({ context: themePaths, path }))
        )
          image = path;
      } else {
        image = await themeImages.first({ context: themePaths, theme });
      }
    } catch (error) {
      // An unavailable decoration must not prevent securing the session.
      console.warn(`Luna Lock background: ${String(error)}; using a solid background`);
    }
    const screen = settings.screen?.path
      ? pathToFileURL(
          join(resolve(dirname(context.configFile), settings.screen.path), "Screen.qml"),
        ).href
      : undefined;
    return {
      ...theme,
      background: { path: image ? pathToFileURL(image).href : "" },
      screen: { path: screen },
    };
  }

  /** Identity is decorative; PAM always authenticates the process's current user. */
  async identity(context: LockContext) {
    const username = userInfo().username;
    for (const name of [".face.icon", ".face"]) {
      const path = context.env.HOME ? join(context.env.HOME, name) : undefined;
      if (path && (await metadata(path))?.isFile())
        return { LUNA_LOCK_USER: username, LUNA_LOCK_USER_ICON: pathToFileURL(path).href };
    }
    return { LUNA_LOCK_USER: username, LUNA_LOCK_USER_ICON: "" };
  }
}

export const lockPresentation = new LockPresentation();
