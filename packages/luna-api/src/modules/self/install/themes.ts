import { readdir } from "node:fs/promises";
import { join } from "pathe";
import { themeContext } from "@/modules/theme/context.ts";
import { locked } from "@/lib/files.ts";
import { themeSelection } from "@/modules/theme/selection.ts";
import { themeAppearance } from "@/modules/theme/appearance.ts";
import { themeStore } from "@/modules/theme/store.ts";
import { themeValues } from "@/modules/theme/values.ts";
import { themePackages } from "@/modules/theme/packages.ts";
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
    const c = themeContext.resolve({ env: context.env, log: context.log });
    await locked(c, async () => {
      const root = join(context.repository, "themes/bundled");
      const entries = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));
      const recipes = await Promise.all(
        entries.map((entry) => themeValues.read(join(root, entry.name))),
      );
      const selected = (await themeSelection.read(c)).value.theme?.name;
      if (selected && !entries.some((entry) => entry.name === selected))
        recipes.push(
          await themeValues.read(await themeSelection.path({ context: c, name: selected })),
        );
      const missing = (
        await Promise.all(
          recipes.map((recipe) => themePackages.missing({ context: c, packages: recipe.packages })),
        )
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
      for (const entry of entries)
        await themeStore.install({
          context: c,
          source: join(root, entry.name),
          name: entry.name,
          force: true,
        });
      if ((await themeSelection.read(c)).value.theme?.name)
        await themePackages.install({
          context: c,
          packages: (await themeSelection.current(c)).packages,
        });
      else {
        const value = await themeSelection.inspect({ context: c, name: "tokyo-night" });
        await themeAppearance.save({ context: c, mode: value.colors.mode, theme: value });
      }
    });
  }
}

export const bundledThemes = new BundledThemes();
