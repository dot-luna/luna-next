import { locked } from "../lib/files.ts";
import { respond } from "../lib/response.ts";
import {
  wallpaperContext,
  type WallpaperOptions,
  type WallpaperInstallOptions,
} from "./context.ts";
import { lookup, readSettings } from "./settings.ts";
import { rendererContext, reload, start, state, stop } from "./runtime.ts";
import { saveSettings } from "./selection.ts";
import {
  currentWallpaper,
  installWallpapers,
  listWallpapers,
  randomWallpaper,
  removeWallpapers,
  selectWallpaper,
  wallpaperPath,
} from "./store.ts";

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

/** One-shot JSONC settings and explicit renderer control. Mutations save, then reload a running instance. */
export const wallpaper = {
  /** Copy validated files, folders or HTTP(S) URLs into stable storage without selecting them. */
  install(source: string | string[], options: WallpaperInstallOptions = {}) {
    return respond(() => installWallpapers(wallpaperContext(options), source, options));
  },
  add(source: string | string[], options: WallpaperInstallOptions = {}) {
    return wallpaper.install(source, options);
  },
  list(options: WallpaperOptions = {}) {
    return respond(() => listWallpapers(wallpaperContext(options)));
  },
  path(name?: string, options: WallpaperOptions = {}) {
    return respond(() => wallpaperPath(wallpaperContext(options), name));
  },
  current(options: WallpaperOptions = {}) {
    return respond(() => currentWallpaper(wallpaperContext(options)));
  },
  random(options: WallpaperOptions = {}) {
    return respond(() => randomWallpaper(wallpaperContext(options)));
  },
  remove(names: string[], options: WallpaperOptions & { dryRun?: boolean } = {}) {
    return respond(() => removeWallpapers(wallpaperContext(options), names, options.dryRun));
  },
  get(key?: string, options: WallpaperOptions = {}) {
    return respond(async () => lookup((await readSettings(wallpaperContext(options))).value, key));
  },
  getConfigFile(options: WallpaperOptions = {}) {
    return respond(() => wallpaperContext(options).configFile);
  },
  /** Merge supplied groups and normalize the owned JSONC document; recover failed application without losing external edits. */
  configure(settings: unknown, options: WallpaperOptions = {}) {
    return respond(() => saveSettings(wallpaperContext(options), settings));
  },
  set(source: string, options: WallpaperOptions = {}) {
    return respond(() => selectWallpaper(wallpaperContext(options), source));
  },
  start: (options: WallpaperOptions = {}) => respond(() => operate("start", options)),
  stop: (options: WallpaperOptions = {}) => respond(() => operate("stop", options)),
  restart: (options: WallpaperOptions = {}) => respond(() => operate("restart", options)),
  reload: (options: WallpaperOptions = {}) => respond(() => operate("reload", options)),
  status: (options: WallpaperOptions = {}) => respond(() => operate("status", options)),
};
