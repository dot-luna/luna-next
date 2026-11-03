import { locked, writeFile } from "../lib/files.ts";
import { ApiError, respond } from "../lib/response.ts";
import { wallpaperContext, type WallpaperOptions } from "./context.ts";
import { lookup, patchSettings, readSettings } from "./settings.ts";
import { rendererContext, reload, snapshot, start, state, stop } from "./runtime.ts";

async function operate(
  action: "status" | "start" | "stop" | "restart" | "reload",
  options: WallpaperOptions,
) {
  const context = await rendererContext(wallpaperContext(options));
  if (action === "status") return state(context);
  return locked(context, async () => {
    if (action === "stop") return stop(context);
    const current = await state(context);
    if (action === "start" && current.running) return current;
    // Validate before stopping a working renderer or publishing a reload snapshot.
    const settings = (await readSettings(context)).value;
    if (action === "restart") await stop(context);
    if (action === "start" || action === "restart") return start(context, settings);
    return current.running ? reload(context, settings) : current;
  });
}

async function configure(patch: unknown, options: WallpaperOptions) {
  const context = wallpaperContext(options);
  return locked(context, async () => {
    const previous = await readSettings(context);
    const value = patchSettings(previous.value, patch);
    const renderer = await rendererContext(context);
    const running = (await state(renderer)).running;
    const active = running ? await snapshot(renderer) : null;
    const next = JSON.stringify(value, null, 2) + "\n";
    await writeFile(context.configFile, next, previous.source);
    if (!running) return value;
    try {
      await reload(renderer, value);
    } catch (error) {
      // Restore exact source only while our write is still present. An external edit
      // also prevents applying an obsolete recovery snapshot to the renderer.
      try {
        await writeFile(context.configFile, previous.source, next);
      } catch (recovery) {
        throw new ApiError(
          recovery instanceof ApiError ? recovery.code : "IO_ERROR",
          `${String(error)}; settings recovery: ${String(recovery)}`,
        );
      }
      try {
        if (active !== null) await reload(renderer, active);
      } catch (recovery) {
        throw new ApiError(
          "COMMAND_FAILED",
          `${String(error)}; renderer recovery: ${String(recovery)}`,
        );
      }
      throw error;
    }
    return value;
  });
}

/** One-shot JSONC settings and explicit renderer control. Mutations save, then reload a running instance. */
export const wallpaper = {
  get(key?: string, options: WallpaperOptions = {}) {
    return respond(async () => lookup((await readSettings(wallpaperContext(options))).value, key));
  },
  getConfigFile(options: WallpaperOptions = {}) {
    return respond(() => wallpaperContext(options).configFile);
  },
  /** Merge supplied groups and normalize the owned JSONC document; recover failed application without losing external edits. */
  configure(settings: unknown, options: WallpaperOptions = {}) {
    return respond(() => configure(settings, options));
  },
  set(source: string, options: WallpaperOptions = {}) {
    return wallpaper.configure({ wallpaper: { source } }, options);
  },
  start: (options: WallpaperOptions = {}) => respond(() => operate("start", options)),
  stop: (options: WallpaperOptions = {}) => respond(() => operate("stop", options)),
  restart: (options: WallpaperOptions = {}) => respond(() => operate("restart", options)),
  reload: (options: WallpaperOptions = {}) => respond(() => operate("reload", options)),
  status: (options: WallpaperOptions = {}) => respond(() => operate("status", options)),
};
