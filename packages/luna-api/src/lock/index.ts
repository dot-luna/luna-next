import { locked } from "../lib/files.ts";
import { ApiError, respond } from "../lib/response.ts";
import { screensaver } from "../screensaver/index.ts";
import { lockContext, rendererContext, type LockOptions } from "./context.ts";
import { acquire, reload, start, state, stop } from "./runtime.ts";
import { configure, settings } from "./settings.ts";
import { display } from "./display.ts";

async function operate(
  action: "start" | "lock" | "lockIdle" | "stop" | "restart" | "reload" | "status",
  options: LockOptions,
) {
  const context = await rendererContext(
    lockContext(options),
    ["start", "lock", "lockIdle", "restart"].includes(action),
  );
  if (action === "status") return state(context);
  return locked(context, async () => {
    if (action === "stop") return stop(context);
    let current = await state(context);
    if (action === "reload") {
      const next = (await settings(context)).value;
      return current.running ? reload(context, next) : current;
    }
    if (action === "restart" || !current.running) {
      const next = (await settings(context)).value;
      if (action === "restart") await stop(context);
      current = await start(context, next);
    }
    if (action === "lock" || action === "lockIdle") {
      // Presentation failures must not prevent securing the session.
      await screensaver.hide({ env: context.env, repository: context.repository });
      return acquire(context, action === "lockIdle");
    }
    return current;
  });
}

/** Control the secure native lock without exposing authentication or an unlock operation over IPC. */
export const lock = {
  get(key?: string, options: LockOptions = {}) {
    return respond(async () => {
      const value = (await settings(lockContext(options))).value;
      if (key === undefined) return value;
      if (!key || key.split(".").some((part) => !part))
        throw new ApiError("INVALID_ARGUMENT", "Lock keys use nonempty dot-separated segments");
      let result: unknown = value;
      for (const part of key.split(".")) {
        if (!result || typeof result !== "object" || !Object.hasOwn(result, part)) return null;
        result = (result as Record<string, unknown>)[part];
      }
      return result;
    });
  },
  getConfigFile: (options: LockOptions = {}) => respond(() => lockContext(options).configFile),
  configure: (value: unknown, options: LockOptions = {}) =>
    respond(() => configure(value, options)),
  start: (options: LockOptions = {}) => respond(() => operate("start", options)),
  lock: (options: LockOptions = {}) => respond(() => operate("lock", options)),
  open: (options: LockOptions = {}) => respond(() => operate("lock", options)),
  /** Recheck native idle state at the shell after any in-flight API work. */
  lockIdle: (options: LockOptions = {}) => respond(() => operate("lockIdle", options)),
  /** Stop/restart are refused atomically by the shell while acquiring or holding the lock. */
  stop: (options: LockOptions = {}) => respond(() => operate("stop", options)),
  restart: (options: LockOptions = {}) => respond(() => operate("restart", options)),
  reload: (options: LockOptions = {}) => respond(() => operate("reload", options)),
  status: (options: LockOptions = {}) => respond(() => operate("status", options)),
  /** Serialized by the native shell so a late off request is always followed by a queued wake. */
  display: (mode: "on" | "off", options: LockOptions = {}) =>
    respond(async () => display(await rendererContext(lockContext(options), false), mode)),
};
