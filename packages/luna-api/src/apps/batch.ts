import { join } from "pathe";
import { childPath, safePath, withLock, within } from "../files.ts";
import { ApiError, errorInfo } from "../response.ts";
import { configure, validateExports } from "./configure.ts";
import { validateHooks } from "./hooks.ts";
import { installPackage, localSource, packageDirectory, uninstallPackage } from "./packages.ts";
import { runtime, status } from "./runtime.ts";
import type { Action, AppExport, AppInfo, BatchResult, Context, Hook } from "./types.ts";

async function preflight(context: Context, action: Action, apps: AppInfo[]): Promise<void> {
  const targets: { path: string; app: string; item: AppExport }[] = [];
  for (const app of apps) {
    if (!app.capabilities.includes(action)) throw new ApiError("UNSUPPORTED_ACTION", `${app.id} does not support ${action}`);
    let hooks: Hook[] = [];
    if (["install", "update", "configure"].includes(action)) {
      hooks = ["before_configure", "after_configure"];
      await validateExports(context, app);
      for (const item of app.manifest.exports ?? []) {
        const target = childPath(context.config, item.target);
        const conflict = targets.find(previous => {
          if (!within(previous.path, target) && !within(target, previous.path)) return false;
          if (previous.app !== app.id || previous.path === target) return true;
          const parent = within(previous.path, target) ? previous : { path: target, item };
          const nested = parent === previous ? target : previous.path;
          return !parent.item.exclude?.some(excluded => within(childPath(parent.path, excluded), nested));
        });
        if (conflict) throw new ApiError("CONFLICT", `Exports overlap between ${conflict.app} and ${app.id}: ${target}`);
        targets.push({ path: target, app: app.id, item });
      }
    }
    if (action === "install" || action === "update") {
      hooks.push("before_install", "after_install");
      if (app.manifest.source === "git" || app.manifest.source === "local") hooks.push("before_build", "build", "after_build");
      if (app.manifest.source === "local") {
        const source = localSource(context, app);
        await safePath(source);
        const destination = packageDirectory(context, app);
        if (within(source, destination) || within(destination, source)) throw new ApiError("INVALID_PATH", "Local source and destination overlap");
        const stat = await Bun.file(source).stat();
        if (!stat.isDirectory()) throw new ApiError("INVALID_PATH", `Local source must be a directory: ${source}`);
      }
    }
    if (action === "uninstall") hooks = ["before_uninstall", "after_uninstall"];
    await validateHooks(app, hooks);
  }
}

/** Validate the complete selection, then execute sequentially and stop on the first failure. */
export async function batch(context: Context, action: Action, apps: AppInfo[]): Promise<BatchResult> {
  await preflight(context, action, apps);
  const result: BatchResult = { action, completed: [], failed: null, unattempted: [] };
  for (const [index, app] of apps.entries()) {
    try {
      context.logger.info({ app: app.id, action }, "Running app action");
      const value = action === "status" ? { app: app.id, status: await status(context, app) }
        : await withLock(join(context.cache, "locks/apps", app.id + ".lock"), async () => {
          switch (action) {
            case "install":
            case "update":
              await installPackage(context, app, action === "update");
              await configure(context, app);
              break;
            case "uninstall": await uninstallPackage(context, app); break;
            case "configure": await configure(context, app); break;
            default: await runtime(context, app, action);
          }
          return { app: app.id };
        });
      result.completed.push(value);
    } catch (error) {
      result.failed = { app: app.id, error: errorInfo(error) };
      result.unattempted = apps.slice(index + 1).map(app => app.id);
      context.logger.error({ app: app.id, action, err: error }, "App action failed");
      return result;
    }
  }
  return result;
}
