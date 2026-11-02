import { readdir } from "node:fs/promises";
import { join } from "pathe";
import { themeContext } from "../../theme/context.ts";
import { locked } from "../../lib/files.ts";
import {
  currentTheme,
  inspectTheme,
  saveAppearance,
  selection,
  themePath,
} from "../../theme/selection.ts";
import { installTheme } from "../../theme/store.ts";
import { readTheme } from "../../theme/values.ts";
import { installThemePackages } from "../../theme/packages.ts";
import { installApps } from "../../apps/index.ts";
import { appContext } from "../../apps/context.ts";
import type { InstallContext } from "./command.ts";

/** Install bundled copies before app configuration, retaining an existing selection. */
export async function installThemes(context: InstallContext) {
  const c = themeContext({ env: context.env });
  await locked(c, async () => {
    const root = join(context.repository, "themes/bundled");
    const entries = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
    const recipes = await Promise.all(entries.map((entry) => readTheme(join(root, entry.name))));
    const selected = (await selection(c)).value.theme?.name;
    if (selected && !entries.some((entry) => entry.name === selected))
      recipes.push(await readTheme(await themePath(c, selected)));
    if (
      recipes.some((recipe) => recipe.packages?.some((item) => item.source === "aur")) &&
      !Bun.which("yay", { PATH: context.env.PATH })
    ) {
      context.progress("Installing yay for theme prerequisites...");
      await installApps(
        await appContext({
          repository: context.repository,
          env: context.env,
          onProgress: context.progress,
        }),
        ["yay"],
      );
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await installTheme(c, join(root, entry.name), entry.name, true);
    }
    if ((await selection(c)).value.theme?.name)
      await installThemePackages(c, (await currentTheme(c)).packages);
    else {
      const value = await inspectTheme(c, "tokyo-night");
      await saveAppearance(c, value.colors.mode, value.name);
    }
  });
}
