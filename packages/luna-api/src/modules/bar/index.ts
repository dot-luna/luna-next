import { respond } from "@/lib/response.ts";
import { barContext, type BarOptions } from "./context.ts";
import { barRuntime } from "./runtime.ts";

/** Each call resolves a fresh context; every operation reports the bar's final state. */
class Bar {
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

  /** Relaunch with a fresh theme snapshot; an invalid theme leaves a running bar untouched. */
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
      await barRuntime.focus(context);
      return barRuntime.state(context);
    });
  }
}

export const bar = new Bar();
