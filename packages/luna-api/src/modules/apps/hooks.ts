import type { InstallContext } from "@/self/install/command.ts";
import { appCatalog, type CatalogApp } from "./catalog.ts";
import type { HookStage } from "./schema.ts";

class AppHooks {
  /** Manifest paths select trusted executable hooks; arguments are never shell-expanded here. */
  async run({
    context,
    app,
    stage,
  }: {
    context: InstallContext;
    app: CatalogApp;
    stage: HookStage;
  }) {
    for (const path of app.manifest.hooks?.[stage] ?? []) {
      const script = await appCatalog.resolveSource({ root: app.directory, relative: path });
      await context.execute([script], false, app.directory, true);
    }
  }
}

export const appHooks = new AppHooks();
