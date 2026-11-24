import { respond } from "@/lib/response.ts";
import { notifyContext, type NotifyContext, type NotifyOptions } from "./context.ts";
import { notifyRuntime } from "./runtime.ts";
import { notifySettings } from "./settings.ts";

/**
 * A standalone toast provider. Start requires exclusive notification ownership; focus never
 * steals focus implicitly. Runtime operations return the provider state after acting.
 */
class Notify {
  /** Read one dot-separated source setting, or all of them; missing keys return null. */
  get(key?: string, options: NotifyOptions = {}) {
    return respond(() => notifySettings.get({ context: notifyContext.settings(options), key }));
  }

  getConfigFile(options: NotifyOptions = {}) {
    return respond(() => notifyContext.settings(options).configFile);
  }

  status(options: NotifyOptions = {}) {
    return this._operate(options, async () => {});
  }

  /** Start Luna's provider; fails with CONFLICT while another provider owns the bus. */
  start(options: NotifyOptions = {}) {
    return this._operate(options, (context) => notifyRuntime.start({ context }));
  }

  stop(options: NotifyOptions = {}) {
    return this._operate(options, (context) => notifyRuntime.stop(context));
  }

  /** Validate the new settings before stopping, so bad settings keep the old provider. */
  restart(options: NotifyOptions = {}) {
    return this._operate(options, (context) => notifyRuntime.restart(context));
  }

  focus(options: NotifyOptions = {}) {
    return this._operate(options, (context) => notifyRuntime.send({ context, method: "focus" }));
  }

  dismiss(options: NotifyOptions = {}) {
    return this._operate(options, (context) => notifyRuntime.send({ context, method: "dismiss" }));
  }

  private _operate(options: NotifyOptions, action: (context: NotifyContext) => Promise<void>) {
    return respond(async () => {
      const context = await notifyContext.resolve(options);
      await action(context);
      return notifyRuntime.state(context);
    });
  }
}

export const notify = new Notify();
