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
  const packages = await readPackages(context, false);
  const owned = new Set(
    [...packages.before_cli, ...packages.after_cli, ...packages.later, ...packages.mise].map(
      (item) => item.name,
    ),
  );
  for (const name of index.packages) {
    const file = await inside(root, name);
    const directory = dirname(file);
    const id = name.split("/")[0]!;
    validate(appNameSchema, id, "App directory name");
    const manifest = validate(appSchema, parse(await Bun.file(file).text(), file), file);
    for (const packageName of [manifest.name, ...(manifest.deps ?? []).map((item) => item.name)]) {
      if (owned.has(packageName))
        throw new ApiError("INVALID_METADATA", `Duplicate package declaration: ${packageName}`);
      owned.add(packageName);
    }
    for (const selector of new Set([id, manifest.name, ...(manifest.alias ?? [])])) {
      if (selectors.has(selector))
        throw new ApiError("INVALID_METADATA", `Ambiguous app selector: ${selector}`);
      selectors.set(selector, id);
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
  return apps;
}

export function selectApps(apps: CatalogApp[], names: string[]) {
  if (!names.length) return apps;
  const selected = new Set<CatalogApp>();
  for (const name of names) {
    const app = apps.find((item) =>
      [item.id, item.manifest.name, ...(item.manifest.alias ?? [])].includes(name),
    );
    if (!app) throw new ApiError("INVALID_ARGUMENT", `Unknown app: ${name}`);
    selected.add(app);
  }
  return apps.filter((app) => selected.has(app));
}
