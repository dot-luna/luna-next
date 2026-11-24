import { readdir } from "node:fs/promises";
import { join } from "pathe";
import { themeContext } from "@/modules/theme/context.ts";
import { locked } from "@/lib/files.ts";
import {
  currentTheme,
  inspectTheme,
  saveAppearance,
  selection,
  themePath,
} from "@/modules/theme/selection.ts";
import { installTheme } from "@/modules/theme/store.ts";
import { readTheme } from "@/modules/theme/values.ts";
import { installThemePackages, missingThemePackages } from "@/modules/theme/packages.ts";
import { appInstaller } from "@/modules/apps/install.ts";
import { appContext } from "@/modules/apps/context.ts";
import type { InstallContext } from "./command.ts";

class BundledThemes {
  /**
   * Replace bundled theme copies before app configuration, under the theme lock.
   * An existing selection is kept and its packages installed; otherwise tokyo-night is applied.
   * Installs yay first when a missing theme package comes from the AUR.
   */
  async install(context: InstallContext) {
    const c = themeContext({ env: context.env }, context.log);
    await locked(c, async () => {
      const root = join(context.repository, "themes/bundled");
      const entries = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));
      const recipes = await Promise.all(entries.map((entry) => readTheme(join(root, entry.name))));
      const selected = (await selection(c)).value.theme?.name;
      if (selected && !entries.some((entry) => entry.name === selected))
        recipes.push(await readTheme(await themePath(c, selected)));
      const missing = (
        await Promise.all(recipes.map((recipe) => missingThemePackages(c, recipe.packages)))
      ).flat();
      if (
        missing.some((item) => item.source === "aur") &&
        !Bun.which("yay", { PATH: context.env.PATH })
      ) {
        context.progress("Installing yay for theme prerequisites...");
        await appInstaller.install({
          context: await appContext.resolve({
            repository: context.repository,
            env: context.env,
            onProgress: context.onProgress,
            log: context.log,
          }),
          names: ["yay"],
        });
      }
      for (const entry of entries) await installTheme(c, join(root, entry.name), entry.name, true);
      if ((await selection(c)).value.theme?.name)
        await installThemePackages(c, (await currentTheme(c)).packages);
      else {
        const value = await inspectTheme(c, "tokyo-night");
        await saveAppearance(c, value.colors.mode, value);
      }
    });
  }
}

export const bundledThemes = new BundledThemes();
