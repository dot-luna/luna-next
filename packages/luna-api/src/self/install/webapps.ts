import { join } from "pathe";
import { parse } from "../../lib/files.ts";
import { validate } from "../../lib/validation.ts";
import { webappContext } from "../../webapp/context.ts";
import { installWebapp } from "../../webapp/index.ts";
import { webappCatalogSchema } from "../../webapp/schema.ts";
import type { InstallContext } from "./command.ts";

export async function readWebapps(context: InstallContext) {
  const path = join(context.repository, "installs/packages.webapp.jsonc");
  return validate(webappCatalogSchema, parse(await Bun.file(path).text(), path), path);
}

/** Reuse interactive web app installation after Chromium app configuration. */
export async function installWebApps(context: InstallContext) {
  const recipes = await readWebapps(context);
  if (!recipes.length) return [];
  const c = webappContext({ env: context.env });
  const installed: string[] = [];
  for (const app of recipes) {
    await installWebapp(c, app.name, app.url);
    installed.push(app.name);
  }
  return installed;
}
