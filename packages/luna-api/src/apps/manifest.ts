import { join, dirname, basename } from "pathe";
import { appSchema, catalogSchema } from "./schema.ts";
import { childPath, entry, readJson, safePath } from "../files.ts";
import { ApiError } from "../response.ts";
import type { Action, AppInfo, AppManifest } from "./types.ts";

function invalid(path: string, errors: string): never {
  throw new ApiError("INVALID_MANIFEST", `Invalid manifest ${path}`, { validation: errors });
}

function capabilities(manifest: AppManifest): Action[] {
  const result: Action[] = ["install", "uninstall", "update", "configure", "status"];
  for (const action of ["start", "stop", "reload", "restart"] as const) {
    if (manifest.runtime?.[action] || (action === "restart" && manifest.runtime?.start && manifest.runtime?.stop)) result.push(action);
  }
  return result;
}

/** Read JSON manifests in catalog order, or discover app directories alphabetically. */
export async function discover(repository: string): Promise<AppInfo[]> {
  const root = join(repository, "apps");
  await safePath(root);
  const catalog = join(root, "apps.conf");
  let paths: string[];
  if (await entry(catalog)) {
    const value = catalogSchema.safeParse(await readJson(catalog));
    if (!value.success) invalid(catalog, value.error.message);
    paths = value.data.packages;
  } else {
    const directories = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: root, onlyFiles: false, dot: true, followSymlinks: false }));
    paths = [];
    for (const directory of directories.sort()) {
      const path = join(directory, "app.conf");
      if ((await entry(join(root, directory)))?.kind === "directory" && await entry(join(root, path))) paths.push(path);
    }
  }
  const names = new Map<string, string>();
  const apps: AppInfo[] = [];
  for (const path of paths) {
    const manifestPath = childPath(root, path);
    const id = basename(dirname(manifestPath));
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(id)) invalid(manifestPath, "Invalid app directory name");
    const parsed = appSchema.safeParse(await readJson(manifestPath));
    if (!parsed.success) invalid(manifestPath, parsed.error.message);
    const value = parsed.data;
    // Package names can differ from directory IDs; reserve each name and alias globally.
    for (const name of new Set([id, value.name, ...(value.alias ?? [])])) {
      const previous = names.get(name);
      if (previous) throw new ApiError("AMBIGUOUS_APP", `${name} identifies both ${previous} and ${id}`);
      names.set(name, id);
    }
    apps.push({ id, directory: dirname(manifestPath), manifest: value, capabilities: capabilities(value) });
  }
  return apps;
}

export function select(apps: AppInfo[], names: readonly string[]): AppInfo[] {
  const requested = names.length ? names : apps.map(app => app.id);
  const ids = new Set<string>();
  return requested.map(name => {
    const app = apps.find(app => app.id === name || app.manifest.name === name || app.manifest.alias?.includes(name));
    if (!app) throw new ApiError("APP_NOT_FOUND", `Unknown app: ${name}`);
    if (ids.has(app.id)) throw new ApiError("DUPLICATE_APP", `App requested more than once: ${app.id}`);
    ids.add(app.id);
    return app;
  });
}
