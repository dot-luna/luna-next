import { respond } from "../lib/response.ts";
import { applyT3, hyprlandTheme } from "./adapters.ts";
import { themeContext } from "./context.ts";
import { locked } from "../lib/files.ts";
import {
  currentTheme,
  effectiveMode,
  inspectTheme,
  saveAppearance,
  selection,
  themePath,
} from "./selection.ts";
import { installTheme, listThemes, removeThemes } from "./store.ts";
import type { ThemeInstallOptions, ThemeMode, ThemeOptions } from "./types.ts";
import { installThemePackages } from "./packages.ts";
import { lookup } from "./values.ts";

/** One-shot theme operations. Mutations lock selection; reads resolve installed JSONC afresh. */
export const theme = {
  install(source: string, options: ThemeInstallOptions = {}) {
    return respond(() => {
      const c = themeContext(options);
      return locked(c, () => installTheme(c, source, options.name, options.force));
    });
  },
  list(options: ThemeOptions = {}) {
    return respond(() => listThemes(themeContext(options)));
  },
  current(options: ThemeOptions = {}) {
    return respond(async () => (await selection(themeContext(options))).value.theme?.name ?? null);
  },
  path(name?: string, options: ThemeOptions = {}) {
    return respond(() => {
      const c = themeContext(options);
      return name === undefined ? c.libraryDir : themePath(c, name);
    });
  },
  get(key?: string, options: ThemeOptions = {}) {
    return respond(async () => lookup(await currentTheme(themeContext(options)), key));
  },
  inspect(name: string, options: ThemeOptions = {}) {
    return respond(() => inspectTheme(themeContext(options), name));
  },
  set(name: string, options: ThemeOptions = {}) {
    return respond(() => {
      const c = themeContext(options);
      return locked(c, async () => {
        const value = await inspectTheme(c, name);
        await installThemePackages(c, value.packages);
        await saveAppearance(c, value.colors.mode, name);
        return value;
      });
    });
  },
  mode(mode?: ThemeMode | "toggle", options: ThemeOptions = {}) {
    return respond(() => {
      const c = themeContext(options);
      return mode === undefined
        ? effectiveMode(c)
        : locked(c, async () => {
            const selected =
              mode === "toggle" ? ((await effectiveMode(c)) === "dark" ? "light" : "dark") : mode;
            await saveAppearance(c, selected);
            return selected;
          });
    });
  },
  toggle(options: ThemeOptions = {}) {
    return theme.mode("toggle", options);
  },
  getConfigFile(options: ThemeOptions = {}) {
    return respond(() => themeContext(options).configFile);
  },
  hyprland(options: ThemeOptions = {}) {
    return respond(async () => hyprlandTheme(await currentTheme(themeContext(options))));
  },
  applyT3code(options: ThemeOptions & { userdata?: string } = {}) {
    return respond(() => {
      const c = themeContext(options);
      return locked(c, () => applyT3(c, options.userdata));
    });
  },
  remove(names: string[], options: ThemeOptions & { dryRun?: boolean } = {}) {
    return respond(() => {
      const c = themeContext(options);
      return locked(c, () => removeThemes(c, names, options.dryRun));
    });
  },
};
