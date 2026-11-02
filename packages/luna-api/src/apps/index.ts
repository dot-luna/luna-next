import { ApiError, respond, type ApiResponse } from "../response.ts";
import { batch } from "./batch.ts";
import { createContext } from "./context.ts";
import { discover, select } from "./manifest.ts";
import type { Action, AppsOptions, BatchResult } from "./types.ts";

export type { Action, AppInfo, AppManifest, AppExport, AppStatus, AppsOptions, BatchResult, CommandRequest, CommandResult, CommandRunner } from "./types.ts";
export { appSchema, catalogSchema } from "./schema.ts";

/** Resolve paths and reread disk manifests on every call. No CLI flags, prompts, or stdout. */
export function createApps(options: AppsOptions = {}) {
  async function action(action: Action, names: readonly string[]): Promise<ApiResponse<BatchResult>> {
    return respond(async () => {
      if (!names.length && ["uninstall", "start", "stop", "reload", "restart"].includes(action)) {
        throw new ApiError("INVALID_ARGUMENT", `${action} requires at least one app name`);
      }
      const context = await createContext(options);
      const result = await batch(context, action, select(await discover(context.repository), names));
      if (result.failed) throw new ApiError("BATCH_FAILED", `${action} failed for ${result.failed.app}`, JSON.parse(JSON.stringify(result)));
      return result;
    });
  }
  return {
    list: () => respond(async () => {
      const context = await createContext(options);
      return discover(context.repository);
    }),
    info: (name: string) => respond(async () => {
      const context = await createContext(options);
      return select(await discover(context.repository), [name])[0]!;
    }),
    install: (names: readonly string[] = []) => action("install", names),
    uninstall: (names: readonly string[]) => action("uninstall", names),
    update: (names: readonly string[] = []) => action("update", names),
    configure: (names: readonly string[] = []) => action("configure", names),
    start: (names: readonly string[]) => action("start", names),
    stop: (names: readonly string[]) => action("stop", names),
    reload: (names: readonly string[]) => action("reload", names),
    restart: (names: readonly string[]) => action("restart", names),
    status: (names: readonly string[] = []) => action("status", names),
  };
}
