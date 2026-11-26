import { join } from "pathe";
import { metadata } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { replaceExport } from "@/lib/tree.ts";
import type { InstallContext } from "@/modules/self/install/command.ts";
import { appCatalog, type CatalogApp } from "./catalog.ts";
import { appHooks } from "./hooks.ts";
import { appIntegration } from "./integration.ts";
import { appAliases } from "./aliases.ts";

class AppConfigurator {
  /**
   * Replace declared exports, integrate native settings and refresh aliases in hook order.
   * The caller holds the app lock. All destinations are resolved before replacing any export;
   * successful earlier writes remain if a later export or hook fails.
   */
  async configure({ context, app }: { context: InstallContext; app: CatalogApp }) {
    context.progress(`Configuring ${app.id}...`);
    await appHooks.run({ context, app, stage: "before_configure" });
    const exports = await Promise.all(
      (app.manifest.exports ?? []).map(async (item) => {
        const source = await appCatalog.resolveSource({
          root: app.directory,
          relative: item.source,
        });
        const target = join(context.env.LUNA_CONFIG_HOME_DIR!, item.target);
        const existing = await metadata(target);
        const current = await metadata(source);
        if (
          existing &&
          !existing.isSymbolicLink() &&
          existing.isDirectory() !== current?.isDirectory()
        )
          throw new ApiError("INVALID_PATH", `Export source/target types differ: ${target}`);
        const destination = item.user_config
          ? await appIntegration.resolveDestination({
              context,
              candidates: item.user_config.dest,
              cwd: app.directory,
            })
          : undefined;
        return { item, source, target, destination };
      }),
    );
    for (const { item, source, target, destination } of exports) {
      await replaceExport(context, source, target, app.directory, item.exclude);
      if (item.user_config && destination)
        await appIntegration.apply({
          source: target,
          target: destination,
          mode: item.user_config.dest_mode,
        });
    }
    await appAliases.configure({ context, app });
    await appHooks.run({ context, app, stage: "after_configure" });
  }
}

export const appConfigurator = new AppConfigurator();
