import { $ } from "bun";
import { dirname, isAbsolute, join, resolve } from "pathe";
import merge from "deepmerge";
import { parse } from "shell-quote";
import { childPath, entry, remove, rename, safePath, temporaryDirectory, within, writeFile } from "../files.ts";
import { command } from "../process.ts";
import { ApiError } from "../response.ts";
import { hooks } from "./hooks.ts";
import type { AppExport, AppInfo, Context } from "./types.ts";

export async function validateExports(context: Context, app: AppInfo): Promise<void> {
  for (const item of app.manifest.exports ?? []) {
    const source = childPath(app.directory, item.source, true);
    const target = childPath(context.config, item.target);
    if (within(source, target) || within(target, source)) throw new ApiError("INVALID_PATH", `Export source and target overlap: ${source}, ${target}`);
    await safePath(source);
    await safePath(target);
    for (const excluded of item.exclude ?? []) childPath(source, excluded);
  }
}

async function exportFile(context: Context, app: AppInfo, item: AppExport): Promise<string> {
  const source = childPath(app.directory, item.source, true);
  const destination = childPath(context.config, item.target);
  await safePath(source);
  await safePath(destination);
  const stat = await Bun.file(source).stat();
  const previous = await entry(destination);
  if (previous && (previous.kind === "directory") !== stat.isDirectory()) throw new ApiError("INVALID_EXPORT", `Source and target must both be files or directories: ${source}, ${destination}`);
  if (item.user_config && !stat.isFile()) throw new ApiError("INVALID_EXPORT", `user_config requires a file export: ${source}`);
  if (item.exclude?.length && !stat.isDirectory()) throw new ApiError("INVALID_EXPORT", `exclude requires a directory export: ${source}`);
  const exclusions = (item.exclude ?? []).map(path => childPath(source, path));
  const stage = await temporaryDirectory(dirname(destination));
  try {
    const temporary = join(stage, "export");
    if (stat.isDirectory()) {
      for await (const suffix of new Bun.Glob("**/*").scan({ cwd: source, onlyFiles: false, dot: true, followSymlinks: false })) {
        const path = childPath(source, suffix);
        if (!exclusions.some(excluded => within(excluded, path))) await safePath(path);
      }
      await $`/usr/bin/cp -a -- ${source} ${temporary}`.quiet();
      for (const excluded of item.exclude ?? []) await remove(childPath(temporary, excluded));
    } else {
      await Bun.write(temporary, Bun.file(source), { mode: stat.mode & 0o777 });
      await $`sync -f -- ${temporary}`.quiet();
    }
    await safePath(destination);
    // Files publish atomically. Whole-folder replacement removes the old folder first;
    // no previous contents are retained as a backup if publication later fails.
    if (previous?.kind === "directory") await remove(destination);
    await rename(temporary, destination);
  } finally { await remove(stage); }
  return destination;
}

async function integrationPath(context: Context, app: AppInfo, candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    let path = candidate;
    if (candidate.startsWith("!")) {
      const argv = parse(candidate.slice(1), context.env);
      if (!argv.length || argv.some(part => typeof part !== "string")) throw new ApiError("INVALID_DESTINATION", "Destination commands must be argument lists without shell operators");
      try {
        const result = await command(context, argv as string[], app.directory, true);
        if (result.exitCode !== 0) continue;
        path = result.stdout.trim();
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") continue;
        throw error;
      }
    } else {
      let missing = false;
      path = path.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/gu, (_, braced: string, bare: string) => {
        const value = context.env[braced ?? bare];
        if (!value) missing = true;
        return value ?? "";
      });
      if (missing) continue;
      if (path.startsWith("~/")) path = join(context.env.HOME!, path.slice(2));
    }
    if (!path) continue;
    if (!isAbsolute(path) || /[\x00-\x1f\x7f]/u.test(path) || path.split("/").includes("..")) throw new ApiError("INVALID_DESTINATION", `Destination must be an absolute path: ${path}`);
    return resolve(path);
  }
  throw new ApiError("INVALID_DESTINATION", `No user configuration destination resolved for ${app.id}`);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function integrate(context: Context, app: AppInfo, item: AppExport, exported: string): Promise<void> {
  const integration = item.user_config!;
  const destination = await integrationPath(context, app, integration.dest);
  if (within(app.directory, destination) || within(context.repository, destination)) throw new ApiError("INVALID_DESTINATION", "User configuration cannot overwrite the source repository");
  if (destination === exported) throw new ApiError("INVALID_DESTINATION", "User configuration cannot overwrite its managed export");
  await safePath(destination);
  const original = await entry(destination) ? await Bun.file(destination).text() : null;
  let text: string;
  if (integration.dest_mode === "merge") {
    let defaults: unknown;
    let current: unknown;
    try {
      defaults = JSON.parse(await Bun.file(exported).text());
      current = original === null ? {} : JSON.parse(original);
    } catch { throw new ApiError("INVALID_JSON", `merge requires JSON object files: ${exported}, ${destination}`); }
    if (!object(defaults) || !object(current)) throw new ApiError("INVALID_JSON", "merge requires JSON objects");
    // Existing arrays, nulls, and scalar values win; missing object leaves inherit defaults.
    text = JSON.stringify(merge(defaults, current, { arrayMerge: (_target, source) => source }), null, 2) + "\n";
  } else {
    const line = integration.include.replace("{{path}}", exported);
    // The manifest owns quoting and native syntax. Restrict inserted paths rather than
    // guessing shell, Lua, or application-specific escaping rules.
    if (/[\s"'`\\]/u.test(exported)) throw new ApiError("INVALID_DESTINATION", "Native include paths cannot contain whitespace, quotes, backticks, or backslashes");
    const current = original ?? "";
    if (current.split(/\r?\n/u).includes(line)) return;
    text = line + "\n" + current;
  }
  await writeFile(destination, text, original);
}

/** Hooks run from the app directory; exports replace their exact declared destinations. */
export async function configure(context: Context, app: AppInfo): Promise<void> {
  await hooks(context, app, "before_configure");
  await validateExports(context, app);
  // Check all generated sources before publishing the first export.
  for (const item of app.manifest.exports ?? []) {
    const source = childPath(app.directory, item.source, true);
    const stat = await entry(source);
    if (!stat) throw new ApiError("INVALID_EXPORT", `Missing export source: ${source}`);
    if (item.user_config && stat.kind !== "file") throw new ApiError("INVALID_EXPORT", `user_config requires a file export: ${source}`);
  }
  for (const item of app.manifest.exports ?? []) {
    const exported = await exportFile(context, app, item);
    if (item.user_config) await integrate(context, app, item, exported);
  }
  await hooks(context, app, "after_configure");
}
