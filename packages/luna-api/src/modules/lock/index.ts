import { locked } from "@/lib/files.ts";
import { respond } from "@/lib/response.ts";
import { screensaver } from "@/modules/screensaver/index.ts";
import { lockContext, type LockOptions } from "./context.ts";
import { lockDisplay } from "./display.ts";
import { lockRuntime } from "./runtime.ts";
import { lockSettings } from "./settings.ts";

type LockAction = "start" | "lock" | "lockIdle" | "stop" | "restart" | "reload" | "status";

/** Control the secure native lock without exposing authentication or an unlock operation over IPC. */
class Lock {
  /** Read all settings, or one dot-separated key; missing keys return null. */
  get(key?: string, options: LockOptions = {}) {
    return respond(() => lockSettings.get({ context: lockContext.resolve(options), key }));
  }

  getConfigFile(options: LockOptions = {}) {
    return respond(() => lockContext.resolve(options).configFile);
  }

  /** Merge and save settings; a running shell reloads them or the save is rolled back. */
  configure(value: unknown, options: LockOptions = {}) {
    return respond(() => lockSettings.configure({ context: lockContext.resolve(options), value }));
  }

  start(options: LockOptions = {}) {
    return respond(() => this._operate({ action: "start", options }));
  }

  /** Start the shell when needed and resolve only once the compositor confirms the lock. */
  lock(options: LockOptions = {}) {
    return respond(() => this._operate({ action: "lock", options }));
  }

  /** Alias of lock. */
  open(options: LockOptions = {}) {
    return respond(() => this._operate({ action: "lock", options }));
  }

  /** Recheck native idle state at the shell after any in-flight API work. */
  lockIdle(options: LockOptions = {}) {
    return respond(() => this._operate({ action: "lockIdle", options }));
  }

  /** Stop/restart are refused atomically by the shell while acquiring or holding the lock. */
  stop(options: LockOptions = {}) {
    return respond(() => this._operate({ action: "stop", options }));
  }

  restart(options: LockOptions = {}) {
    return respond(() => this._operate({ action: "restart", options }));
  }

  /** Reload saved settings into a running shell; a stopped shell stays stopped. */
  reload(options: LockOptions = {}) {
    return respond(() => this._operate({ action: "reload", options }));
  }

  status(options: LockOptions = {}) {
    return respond(() => this._operate({ action: "status", options }));
  }

  /** Serialized by the native shell so a late off request is always followed by a queued wake. */
  display(mode: "on" | "off", options: LockOptions = {}) {
    return respond(async () => {
      const context = await lockContext.renderer({
        context: lockContext.resolve(options),
        requireShell: false,
      });
      return lockDisplay.power({ context, mode });
    });
  }

  /** Serialize state changes under the config lock; status reads without it. */
  private async _operate({ action, options }: { action: LockAction; options: LockOptions }) {
    const context = await lockContext.renderer({
      context: lockContext.resolve(options),
      requireShell: ["start", "lock", "lockIdle", "restart"].includes(action),
    });
    if (action === "status") return lockRuntime.state(context);
    return locked(context, async () => {
      if (action === "stop") return lockRuntime.stop(context);
      let current = await lockRuntime.state(context);
      if (action === "reload") {
        const settings = (await lockSettings.read(context)).value;
        return current.running ? lockRuntime.reload({ context, settings }) : current;
      }
      if (action === "restart" || !current.running) {
        const settings = (await lockSettings.read(context)).value;
        if (action === "restart") await lockRuntime.stop(context);
        current = await lockRuntime.start({ context, settings });
      }
      if (action === "lock" || action === "lockIdle") {
        // hide reports failures in its response; presentation must not prevent securing the session.
        await screensaver.hide({ env: context.env, repository: context.repository });
        return lockRuntime.acquire({ context, idle: action === "lockIdle" });
      }
      return current;
    });
  }
}

export const lock = new Lock();
