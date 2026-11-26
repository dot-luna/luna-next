import { locked } from "@/lib/files.ts";
import { respond } from "@/lib/response.ts";
import { polkitContext, type PolkitOptions } from "./context.ts";
import { polkitRuntime } from "./runtime.ts";
import { polkitSettings } from "./settings.ts";

/** Desktop authentication lifecycle. Passwords never pass through this API or CLI IPC. */
class Polkit {
  /** Read source settings; missing keys return null. */
  get(key?: string, options: PolkitOptions = {}) {
    return respond(() => polkitSettings.get({ context: polkitContext.settings(options), key }));
  }
  getConfigFile(options: PolkitOptions = {}) {
    return respond(() => polkitContext.settings(options).configFile);
  }
  start(options: PolkitOptions = {}) {
    return this._operate("start", options);
  }
  stop(options: PolkitOptions = {}) {
    return this._operate("stop", options);
  }
  /** Validate settings and QML before replacing a running instance. */
  restart(options: PolkitOptions = {}) {
    return this._operate("restart", options);
  }
  status(options: PolkitOptions = {}) {
    return this._operate("status", options);
  }

  private _operate(action: "start" | "stop" | "restart" | "status", options: PolkitOptions) {
    return respond(async () => {
      const context = await polkitContext.resolve(options);
      if (action === "status") return polkitRuntime.state(context);
      return locked(context, async () => {
        if (action === "stop") return polkitRuntime.stop(context);
        const state = await polkitRuntime.state(context);
        if (action === "start" && state.running) return state;
        const prepared = await polkitRuntime.prepare(context);
        if (state.status !== "stopped") await polkitRuntime.stop(context);
        return polkitRuntime.start(prepared);
      });
    });
  }
}
export const polkit = new Polkit();
