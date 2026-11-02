import { join } from "pathe";
import { metadata } from "../lib/files.ts";
import { ApiError } from "../lib/response.ts";
import { replaceExport } from "../lib/tree.ts";
import type { InstallContext } from "../self/install/command.ts";
import { inside, type CatalogApp } from "./catalog.ts";
import { runHooks } from "./hooks.ts";
import { integrate, userDestination } from "./integration.ts";
import { configureAliases } from "./aliases.ts";

export async function configureApp(context: InstallContext, app: CatalogApp) {
  context.progress(`Configuring ${app.id}...`);
  await runHooks(context, app, "before_configure");
  const exports = await Promise.all(
    (app.manifest.exports ?? []).map(async (item) => {
      const source = await inside(app.directory, item.source);
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
        ? await userDestination(context, item.user_config.dest, app.directory)
        : undefined;
      return { item, source, target, destination };
    }),
  );
  for (const { item, source, target, destination } of exports) {
    await replaceExport(context, source, target, app.directory, item.exclude);
    if (item.user_config && destination)
      await integrate(target, destination, item.user_config.dest_mode);
  }
  await configureAliases(context, app);
  await runHooks(context, app, "after_configure");
}
