import { isAbsolute, join } from "pathe";
import { locked, parse } from "@/lib/files.ts";
import { validate } from "@/lib/validation.ts";
import { themeContext } from "@/modules/theme/lib/context.ts";
import { themeSelection } from "@/modules/theme/lib/selection.ts";
import { themeAppearance } from "@/modules/theme/lib/appearance.ts";
import { themeSource } from "@/modules/theme/lib/source.ts";
import { themePackages } from "@/modules/theme/lib/packages.ts";
import { themeInstallListSchema } from "@/modules/theme/schema.ts";
import { appInstaller } from "@/modules/apps/install.ts";
import { appContext } from "@/modules/apps/context.ts";
import type { InstallContext } from "./command.ts";

class PreinstalledThemes {
  async read(context: InstallContext) {
    const path = join(context.repository, "installs/themes.jsonc");
    return validate(themeInstallListSchema, parse(await Bun.file(path).text(), path), path).map(
      (item) => ({
        ...item,
        source:
          isAbsolute(item.source) || /^[a-z][a-z0-9+.-]*:\/\//iu.test(item.source)
            ? item.source
            : join(context.repository, item.source),
      }),
    );
  }

  /** Install declared sources before app configuration, retaining an existing selection. */
  async install(context: InstallContext) {
    const c = themeContext.resolve({ env: context.env, log: context.log });
    const entries = await this.read(context);
    await locked(c, async () => {
      const plans = [];
      for (const entry of entries)
        plans.push(await themeSource.preview({ context: c, source: entry.source }));
      const selected = (await themeSelection.read(c)).value.theme?.name;
      const selectedPackages =
        selected && !entries.some((entry) => entry.name === selected)
          ? (await themeSelection.current(c)).packages
          : [];
      const missing = [
        ...plans.flatMap((plan) => plan.packages.filter((item) => !item.installed)),
        ...(await themePackages.missing({ context: c, packages: selectedPackages })),
      ];
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
      for (const [index, entry] of entries.entries()) {
        const plan = plans[index]!;
        context.progress(`Installing theme ${entry.name}...`);
        await themeSource.install({
          context: c,
          source: entry.source,
          options: { name: entry.name, force: true, fingerprint: plan.fingerprint },
        });
      }
      if (selected)
        await themePackages.install({
          context: c,
          packages: (await themeSelection.current(c)).packages,
        });
      else if (entries.length) {
        const name = entries.some((entry) => entry.name === "tokyo-night")
          ? "tokyo-night"
          : entries[0]!.name;
        const value = await themeSelection.inspect({ context: c, name });
        await themeAppearance.save({ context: c, mode: value.colors.mode, theme: value });
      }
    });
  }
}
export const preinstalledThemes = new PreinstalledThemes();
