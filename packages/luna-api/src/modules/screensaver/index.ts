import { locked } from "@/lib/files.ts";
import { respond } from "@/lib/response.ts";
import { screensaverContext, type ScreensaverOptions } from "./context.ts";
import { screensaverRuntime } from "./runtime.ts";
import { screensaverSettings } from "./settings.ts";

type ScreensaverAction =
  | "start"
  | "show"
  | "showIdle"
  | "hide"
  | "stop"
  | "restart"
  | "reload"
  | "status";

/** Explicit JSONC settings and one-shot shell control; idle input reaches the same show operation as the CLI. */
class Screensaver {
  /** Read all settings, or one dot-separated key; missing keys return null. */
  get(key?: string, options: ScreensaverOptions = {}) {
    return respond(() =>
      screensaverSettings.get({ context: screensaverContext.resolve(options), key }),
    );
  }

  getConfigFile(options: ScreensaverOptions = {}) {
    return respond(() => screensaverContext.resolve(options).configFile);
  }

  /** Merge and save settings; a running shell reloads them or the save is rolled back. */
  configure(value: unknown, options: ScreensaverOptions = {}) {
    return respond(() =>
      screensaverSettings.configure({ context: screensaverContext.resolve(options), value }),
    );
  }

  start(options: ScreensaverOptions = {}) {
    return respond(() => this._operate({ action: "start", options }));
  }

  /** Start the shell when needed and show it, unless the Hyprland session is locked. */
  show(options: ScreensaverOptions = {}) {
    return respond(() => this._operate({ action: "show", options }));
  }

  /** Recheck native idle state when the request arrives so resumed input wins an in-flight request. */
  showIdle(options: ScreensaverOptions = {}) {
    return respond(() => this._operate({ action: "showIdle", options }));
  }

  /** Alias of show. */
  open(options: ScreensaverOptions = {}) {
    return respond(() => this._operate({ action: "show", options }));
  }

  /** Hide a running shell; a stopped shell is not started. */
  hide(options: ScreensaverOptions = {}) {
    return respond(() => this._operate({ action: "hide", options }));
  }

  stop(options: ScreensaverOptions = {}) {
    return respond(() => this._operate({ action: "stop", options }));
  }

  restart(options: ScreensaverOptions = {}) {
    return respond(() => this._operate({ action: "restart", options }));
  }

  /** Reload saved settings into a running shell; a stopped shell stays stopped. */
  reload(options: ScreensaverOptions = {}) {
    return respond(() => this._operate({ action: "reload", options }));
  }

  status(options: ScreensaverOptions = {}) {
    return respond(() => this._operate({ action: "status", options }));
  }

  /** Serialize state changes under the config lock; status reads without it. */
  private async _operate({
    action,
    options,
  }: {
    action: ScreensaverAction;
    options: ScreensaverOptions;
  }) {
    const context = await screensaverContext.renderer(screensaverContext.resolve(options));
    if (action === "status") return screensaverRuntime.state(context);
    return locked(context, async () => {
      if (action === "stop") return screensaverRuntime.stop(context);
      let current = await screensaverRuntime.state(context);
      if (action === "hide") {
        if (current.running) await screensaverRuntime.ipc({ context, method: "hide" });
        return screensaverRuntime.state(context);
      }
      if (action === "reload") {
        const settings = (await screensaverSettings.read(context)).value;
        return current.running ? screensaverRuntime.reload({ context, settings }) : current;
      }
      if (action === "restart" || !current.running) {
        const settings = (await screensaverSettings.read(context)).value;
        if (action === "restart") await screensaverRuntime.stop(context);
        current = await screensaverRuntime.start({ context, settings });
      }
      if (action === "show" || action === "showIdle") {
        const sessionLocked = await screensaverRuntime.sessionLocked(context);
        await screensaverRuntime.ipc({ context, method: sessionLocked ? "hide" : action });
        return screensaverRuntime.state(context);
      }
      return current;
    });
  }
}

export const screensaver = new Screensaver();
