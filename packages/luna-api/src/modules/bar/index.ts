import { respond } from "@/lib/response.ts";
import { barContext, type BarOptions } from "./context.ts";
import { barRuntime } from "./runtime.ts";
import { barSettings } from "./settings.ts";

/** Each call resolves a fresh context; every operation reports the bar's final state. */
class Bar {
  /** Read one dot-separated source setting, or all of them; missing keys return null. */
  get(key?: string, options: BarOptions = {}) {
    return respond(() => barSettings.get({ context: barContext.settings(options), key }));
  }

  getConfigFile(options: BarOptions = {}) {
    return respond(() => barContext.settings(options).configFile);
  }

  status(options: BarOptions = {}) {
    return respond(async () => barRuntime.state(await barContext.resolve(options)));
  }

  /** Start the bar unless this shell directory's instance is already running. */
  start(options: BarOptions = {}) {
    return respond(async () => {
      const context = await barContext.resolve(options);
      if (!(await barRuntime.running(context)))
        await barRuntime.launch({ context, replace: false });
      return barRuntime.state(context);
    });
  }

  stop(options: BarOptions = {}) {
    return respond(async () => {
      const context = await barContext.resolve(options);
      if (await barRuntime.running(context)) await barRuntime.kill(context);
      return barRuntime.state(context);
    });
  }

  /** Relaunch with fresh snapshots; an invalid theme or settings file leaves a running bar untouched. */
  restart(options: BarOptions = {}) {
    return respond(async () => {
      const context = await barContext.resolve(options);
      await barRuntime.launch({ context, replace: await barRuntime.running(context) });
      return barRuntime.state(context);
    });
  }

  /** Focus the bar, starting it first when it is not running. */
  focus(options: BarOptions = {}) {
    return respond(async () => {
      const context = await barContext.resolve(options);
      if (!(await barRuntime.running(context)))
        await barRuntime.launch({ context, replace: false });
      await barRuntime.send({ context, method: "focus" });
      return barRuntime.state(context);
    });
  }

  /** Show or hide the bar on every screen; a stopped bar starts visible. */
  toggle(options: BarOptions = {}) {
    return respond(async () => {
      const context = await barContext.resolve(options);
      if (await barRuntime.running(context)) await barRuntime.send({ context, method: "toggle" });
      else await barRuntime.launch({ context, replace: false });
      return barRuntime.state(context);
    });
  }
}

export const bar = new Bar();
