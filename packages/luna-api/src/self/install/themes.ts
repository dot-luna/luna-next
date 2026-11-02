import { readdir } from "node:fs/promises";
import { join } from "pathe";
import { themeContext } from "../../theme/context.ts";
import { locked } from "../../theme/files.ts";
import { currentTheme, inspectTheme, saveAppearance, selection } from "../../theme/selection.ts";
import { installTheme } from "../../theme/store.ts";
import type { InstallContext } from "./command.ts";

/** Install bundled copies before app configuration, retaining an existing selection. */
export async function installThemes(context: InstallContext) {
  const c = themeContext({ env: context.env });
  await locked(c, async () => {
    const root = join(context.repository, "themes/bundled");
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.isDirectory()) await installTheme(c, join(root, entry.name), entry.name, true);
    }
    if ((await selection(c)).value.theme?.name) await currentTheme(c);
    else {
      const value = await inspectTheme(c, "tokyo-night");
      await saveAppearance(c, value.colors.mode, value.name);
    }
  });
}
