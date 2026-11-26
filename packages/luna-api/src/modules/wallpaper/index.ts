import { locked } from "@/lib/files.ts";
import { respond } from "@/lib/response.ts";
import {
  wallpaperConfig,
  type WallpaperOptions,
  type WallpaperInstallOptions,
  type WallpaperSetOptions,
  type WallpaperState,
} from "./config.ts";
import { wallpaperRenderer, type RendererContext } from "./runtime.ts";
import { wallpaperStore } from "./store.ts";
import { login } from "@/modules/login/index.ts";

/**
 * One-shot JSONC settings and renderer control, with optional automatic config reloads.
 * Mutations validate and save atomically, then reload a running renderer.
 */
class Wallpaper {
  /** Copy validated files, folders or HTTP(S) URLs into stable storage without selecting them. */
  install(source: string | string[], options: WallpaperInstallOptions = {}) {
    return respond(() =>
      wallpaperStore.install({ context: wallpaperConfig.resolve(options), source, options }),
    );
  }

  /** Alias of install. */
  add(source: string | string[], options: WallpaperInstallOptions = {}) {
    return this.install(source, options);
  }

  list(options: WallpaperOptions = {}) {
    return respond(() => wallpaperStore.list(wallpaperConfig.resolve(options)));
  }

  /** Return the library directory, or an installed wallpaper's file path. */
  path(name?: string, options: WallpaperOptions = {}) {
    return respond(() => wallpaperStore.path({ context: wallpaperConfig.resolve(options), name }));
  }

  /** Return the saved source, or null when none is selected. */
  current(options: WallpaperOptions = {}) {
    return respond(() => wallpaperStore.current(wallpaperConfig.resolve(options)));
  }

  /** Select a different installed wallpaper at random. */
  random(options: WallpaperOptions = {}) {
    return respond(() => wallpaperStore.random(wallpaperConfig.resolve(options)));
  }

  /** Delete installed wallpapers that are neither selected nor playing; dryRun only validates. */
  remove(names: string[], options: WallpaperOptions & { dryRun?: boolean } = {}) {
    return respond(() =>
      wallpaperStore.remove({
        context: wallpaperConfig.resolve(options),
        names,
        dryRun: options.dryRun,
      }),
    );
  }

  /** Read saved settings or one dot-separated key; missing keys return null. */
  get(key?: string, options: WallpaperOptions = {}) {
    return respond(async () =>
      wallpaperConfig.lookup({
        settings: (await wallpaperConfig.read(wallpaperConfig.resolve(options))).value,
        key,
      }),
    );
  }

  getConfigFile(options: WallpaperOptions = {}) {
    return respond(() => wallpaperConfig.resolve(options).configFile);
  }

  /** Merge supplied groups and normalize the owned JSONC document; recover failed application without losing external edits. */
  configure(settings: unknown, options: WallpaperOptions = {}) {
    return respond(() =>
      wallpaperConfig.save({ context: wallpaperConfig.resolve(options), patch: settings }),
    );
  }

  /** Persist config watching and apply it immediately; a stopped renderer stays stopped. */
  watch(enabled: boolean, options: WallpaperOptions = {}) {
    return this.configure({ watch_config: enabled }, options);
  }

  /** Select an installed name, an absolute path, or "" to clear the source. */
  set(source: string, options: WallpaperSetOptions = {}) {
    if (options.login)
      return login.setWallpaper(source, {
        configFile: options.loginConfigFile,
        repository: options.repository,
        systemRoot: options.systemRoot,
        env: options.env,
      });
    return respond(() =>
      wallpaperStore.select({ context: wallpaperConfig.resolve(options), source }),
    );
  }

  /** Start with the saved settings unless the renderer is already running. */
  start(options: WallpaperOptions = {}) {
    return this._control(options, async (context) => {
      const current = await wallpaperRenderer.state(context);
      if (current.running) return current;
      const settings = (await wallpaperConfig.read(context)).value;
      return wallpaperRenderer.start({ context, settings });
    });
  }

  stop(options: WallpaperOptions = {}) {
    return this._control(options, (context) => wallpaperRenderer.stop(context));
  }

  /** Replace the renderer process; invalid settings leave a working renderer running. */
  restart(options: WallpaperOptions = {}) {
    return this._control(options, async (context) => {
      const settings = (await wallpaperConfig.read(context)).value;
      await wallpaperRenderer.stop(context);
      return wallpaperRenderer.start({ context, settings });
    });
  }

  /** Send saved settings to a running renderer; a stopped renderer stays stopped. */
  reload(options: WallpaperOptions = {}) {
    return this._control(options, async (context) => {
      const current = await wallpaperRenderer.state(context);
      // Validate even when stopped so invalid settings are always reported.
      const settings = (await wallpaperConfig.read(context)).value;
      return current.running ? wallpaperRenderer.reload({ context, settings }) : current;
    });
  }

  status(options: WallpaperOptions = {}) {
    return respond(async () =>
      wallpaperRenderer.state(await wallpaperRenderer.resolve(wallpaperConfig.resolve(options))),
    );
  }

  /** Lifecycle changes hold the config lock so they cannot interleave with settings saves. */
  private _control(
    options: WallpaperOptions,
    operation: (context: RendererContext) => Promise<WallpaperState>,
  ) {
    return respond(async () => {
      const context = await wallpaperRenderer.resolve(wallpaperConfig.resolve(options));
      return locked(context, () => operation(context));
    });
  }
}

export const wallpaper = new Wallpaper();
