import { join } from "pathe";
import { parse } from "@/lib/files.ts";
import { validate } from "@/lib/validation.ts";
import { webappContext } from "@/modules/webapp/context.ts";
import { webapp } from "@/modules/webapp/index.ts";
import { webappCatalogSchema } from "@/modules/webapp/schema.ts";
import type { InstallContext } from "./command.ts";
import { installReport, type InstallFailure } from "./report.ts";

class BundledWebapps {
  /** Read and validate installs/packages.webapp.jsonc. */
  async read(context: InstallContext) {
    const path = join(context.repository, "installs/packages.webapp.jsonc");
    return validate(webappCatalogSchema, parse(await Bun.file(path).text(), path), path);
  }

  /**
   * Install each listed web app after Chromium app configuration, reusing the interactive
   * web app installation. Failures are recorded in failed; see installReport.attempt.
   */
  async install({
    context,
    skipFailed = false,
    failed = [],
  }: {
    context: InstallContext;
    skipFailed?: boolean;
    failed?: InstallFailure[];
  }) {
    const recipes = await this.read(context);
    if (!recipes.length) return [];
    const appContext = webappContext.resolve({ env: context.env });
    const installed: string[] = [];
    for (const app of recipes) {
      const retry = `${installReport.quote(join(context.home, ".local/bin/luna"))} webapp install ${installReport.quote(app.name)} ${installReport.quote(app.url)}`;
      if (
        await installReport.attempt({
          context,
          app: `webapp:${app.name}`,
          retry,
          skipFailed,
          failed,
          operation: () => webapp.installWithContext(appContext, app),
        })
      )
        installed.push(app.name);
    }
    return installed;
  }
}

export const bundledWebapps = new BundledWebapps();
