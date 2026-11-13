import { realpath } from "node:fs/promises";
import { dirname, join } from "pathe";
import { ApiError } from "../lib/response.ts";
import { readPackages } from "../self/install/packages.ts";
import type { InstallContext } from "../self/install/command.ts";
import { parse, metadata } from "../lib/files.ts";
import { validate } from "../lib/validation.ts";
import { appNameSchema, appSchema, appsIndexSchema, type AppManifest } from "./schema.ts";

export interface CatalogApp {
  id: string;
  directory: string;
  manifest: AppManifest;
}

export async function inside(root: string, relative: string) {
  const path = await realpath(join(root, relative));
  if (!path.startsWith(root + "/"))
    throw new ApiError("INVALID_PATH", `Path escapes its declared source: ${relative}`);
  return path;
}

/** Validate the entire ordered catalog and package ownership before hooks or package writes. */
export async function readCatalog(context: InstallContext) {
  const root = await realpath(join(context.repository, "apps"));
  const indexPath = join(root, "apps.jsonc");
  const index = validate(
    appsIndexSchema,
    parse(await Bun.file(indexPath).text(), indexPath),
    indexPath,
  );
  const apps: CatalogApp[] = [];
  const selectors = new Map<string, string>();
  const aliases = new Set<string>();
  const packages = await readPackages(context, false);
  const dependencies = new Map(
    [...packages.before_cli, ...packages.after_cli, ...packages.later, ...packages.mise].map(
      (item) => [item.name, item],
    ),
  );
  const primaryNames = new Set<string>();
  for (const name of index.packages) {
    const file = await inside(root, name);
    const directory = dirname(file);
    const id = name.split("/")[0]!;
    validate(appNameSchema, id, "App directory name");
    const manifest = validate(appSchema, parse(await Bun.file(file).text(), file), file);
    if (primaryNames.has(manifest.name) || dependencies.has(manifest.name))
      throw new ApiError("INVALID_METADATA", `Duplicate package declaration: ${manifest.name}`);
    primaryNames.add(manifest.name);
    for (const selector of new Set([id, manifest.name])) {
      if (selectors.has(selector))
        throw new ApiError("INVALID_METADATA", `Ambiguous app selector: ${selector}`);
      selectors.set(selector, id);
    }
    for (const entry of manifest.alias ?? []) {
      const alias = typeof entry === "string" ? entry : entry[0];
      if (aliases.has(alias))
        throw new ApiError("INVALID_METADATA", `Duplicate shell alias: ${alias}`);
      aliases.add(alias);
    }
    for (const paths of Object.values(manifest.hooks ?? {}))
      for (const hook of paths) {
        const script = await inside(directory, hook);
        const info = await metadata(script);
        if (!info?.isFile() || !(info.mode & 0o111))
          throw new ApiError("INVALID_METADATA", `App hook must be an executable file: ${script}`);
      }
    apps.push({ id, directory, manifest });
  }
  // Collect app ownership first so a dependency cannot claim a later app's name.
  // Shared prerequisites stay in each manifest for standalone app installation.
  for (const app of apps) {
    for (const dependency of app.manifest.deps ?? []) {
      if (primaryNames.has(dependency.name))
        throw new ApiError("INVALID_METADATA", `Duplicate package declaration: ${dependency.name}`);
      const previous = dependencies.get(dependency.name);
      if (
        previous &&
        (previous.source !== dependency.source || previous.version !== dependency.version)
      )
        throw new ApiError(
          "INVALID_METADATA",
          `Conflicting dependency declaration: ${dependency.name}`,
        );
      dependencies.set(dependency.name, dependency);
    }
  }
  return apps;
}

export function selectApps(apps: CatalogApp[], names: string[]) {
  if (!names.length) return apps;
  const selected = new Set<CatalogApp>();
  for (const name of names) {
    const app = apps.find((item) => [item.id, item.manifest.name].includes(name));
    if (!app) throw new ApiError("INVALID_ARGUMENT", `Unknown app: ${name}`);
    selected.add(app);
  }
  return apps.filter((app) => selected.has(app));
}
