import type { InstallContext } from "../self/install/command.ts";
import { inside, type CatalogApp } from "./catalog.ts";
import type { HookStage } from "./schema.ts";

/** Manifest paths select trusted executable hooks; arguments are never shell-expanded here. */
export async function runHooks(context: InstallContext, app: CatalogApp, stage: HookStage) {
  for (const path of app.manifest.hooks?.[stage] ?? []) {
    const script = await inside(app.directory, path);
    await context.execute([script], false, app.directory, true);
  }
}
