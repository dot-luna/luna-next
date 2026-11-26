import { locked } from "@/lib/files.ts";
import { respond } from "@/lib/response.ts";
import { themeAdapters } from "./adapters.ts";
import { themeAppearance } from "./appearance.ts";
import { themeContext, type ThemeInstallOptions, type ThemeOptions } from "./context.ts";
import { themePackages } from "./packages.ts";
import type { ThemeMode } from "./schema.ts";
import { themeSelection } from "./selection.ts";
import { themeStore } from "./store.ts";
import { themeValues } from "./values.ts";

/** One-shot theme operations. Mutations lock the selection; reads resolve installed JSONC afresh. */
class Theme {
  /** Copy a theme folder into the library and import its wallpapers; force replaces it. */
  install(source: string, options: ThemeInstallOptions = {}) {
    return respond(() => {
      const context = themeContext.resolve(options);
      return locked(context, () =>
        themeStore.install({ context, source, name: options.name, force: options.force }),
      );
    });
  }

  /** List installed themes, marking the selected one. */
  list(options: ThemeOptions = {}) {
    return respond(() => themeStore.list(themeContext.resolve(options)));
  }

  /** Selected theme name, or null when none is selected. */
  current(options: ThemeOptions = {}) {
    return respond(
      async () =>
        (await themeSelection.read(themeContext.resolve(options))).value.theme?.name ?? null,
    );
  }

  /** Library directory, or an installed theme's folder when named. */
  path(name?: string, options: ThemeOptions = {}) {
    return respond(() => {
      const context = themeContext.resolve(options);
      return name === undefined ? context.libraryDir : themeSelection.path({ context, name });
    });
  }

  /** Resolved current theme, or the value at a dot-separated key (null when absent). */
  get(key?: string, options: ThemeOptions = {}) {
    return respond(async () =>
      themeValues.lookup({
        theme: await themeSelection.current(themeContext.resolve(options)),
        key,
      }),
    );
  }

  /** Resolve an installed theme without selecting it. */
  inspect(name: string, options: ThemeOptions = {}) {
    return respond(() => themeSelection.inspect({ context: themeContext.resolve(options), name }));
  }

  /** Select an installed theme in its own mode after installing missing prerequisites. */
  set(name: string, options: ThemeOptions = {}) {
    return respond(() => {
      const context = themeContext.resolve(options);
      return locked(context, async () => {
        const value = await themeSelection.inspect({ context, name });
        await themePackages.install({ context, packages: value.packages });
        await themeAppearance.save({ context, mode: value.colors.mode, theme: value });
        return value;
      });
    });
  }

  /** Return the effective mode, or set dark, light or the opposite of the effective mode. */
  mode(mode?: ThemeMode | "toggle", options: ThemeOptions = {}) {
    return respond(() => {
      const context = themeContext.resolve(options);
      if (mode === undefined) return themeAppearance.mode(context);
      return locked(context, async () => {
        const selected =
          mode === "toggle"
            ? (await themeAppearance.mode(context)) === "dark"
              ? "light"
              : "dark"
            : mode;
        await themeAppearance.save({ context, mode: selected });
        return selected;
      });
    });
  }

  /** Switch between dark and light mode. */
  toggle(options: ThemeOptions = {}) {
    return this.mode("toggle", options);
  }

  /** Path of the theme selection file. */
  getConfigFile(options: ThemeOptions = {}) {
    return respond(() => themeContext.resolve(options).configFile);
  }

  /** Current theme as Hyprland settings. */
  hyprland(options: ThemeOptions = {}) {
    return respond(async () =>
      themeAdapters.hyprland(await themeSelection.current(themeContext.resolve(options))),
    );
  }

  /** Publish the current theme to T3 Code; userdata overrides its settings directory. */
  applyT3code(options: ThemeOptions & { userdata?: string } = {}) {
    return respond(() => {
      const context = themeContext.resolve(options);
      return locked(context, () => themeAdapters.t3({ context, userdata: options.userdata }));
    });
  }

  /** Remove installed themes other than the current one; dryRun only returns their paths. */
  remove(names: string[], options: ThemeOptions & { dryRun?: boolean } = {}) {
    return respond(() => {
      const context = themeContext.resolve(options);
      return locked(context, () => themeStore.remove({ context, names, dryRun: options.dryRun }));
    });
  }
}

export const theme = new Theme();
