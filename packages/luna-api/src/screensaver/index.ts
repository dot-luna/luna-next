import { locked, readDocument, writeFile } from "../lib/files.ts";
import { ApiError, respond } from "../lib/response.ts";
import { validate } from "../lib/validation.ts";
import {
  screensaverContext,
  rendererContext,
  type ScreensaverContext,
  type ScreensaverOptions,
} from "./context.ts";
import { screensaverSettingsSchema } from "./schema.ts";
import { ipc, reload, sessionLocked, snapshot, start, state, stop } from "./runtime.ts";

async function settings(context: ScreensaverContext) {
  const document = await readDocument(context.configFile);
  return {
    source: document.source,
    value: validate(screensaverSettingsSchema, document.value, context.configFile),
  };
}
async function operate(
  action: "start" | "show" | "showIdle" | "hide" | "stop" | "restart" | "reload" | "status",
  options: ScreensaverOptions,
) {
  const context = await rendererContext(screensaverContext(options));
  if (action === "status") return state(context);
  return locked(context, async () => {
    if (action === "stop") return stop(context);
    let current = await state(context);
    if (action === "hide") {
      if (current.running) await ipc(context, "hide");
      return state(context);
    }
    if (action === "reload") {
      const next = (await settings(context)).value;
      return current.running ? reload(context, next) : current;
    }
    if (action === "restart" || !current.running) {
      const next = (await settings(context)).value;
      if (action === "restart") await stop(context);
      current = await start(context, next);
    }
    if (action === "show" || action === "showIdle") {
      await ipc(context, (await sessionLocked(context)) ? "hide" : action);
      return state(context);
    }
    return current;
  });
}
async function configure(value: unknown, options: ScreensaverOptions) {
  const context = screensaverContext(options);
  const patch = screensaverSettingsSchema.safeParse(value);
  if (!patch.success) throw new ApiError("INVALID_ARGUMENT", patch.error.message);
  return locked(context, async () => {
    const previous = await settings(context);
    const next = { ...previous.value, ...patch.data };
    const renderer = await rendererContext(context);
    const running = (await state(renderer)).running;
    const active = running ? await snapshot(renderer) : null;
    const source = JSON.stringify(next, null, 2) + "\n";
    await writeFile(context.configFile, source, previous.source);
    if (running)
      try {
        await reload(renderer, next);
      } catch (error) {
        try {
          await writeFile(context.configFile, previous.source, source);
        } catch (recovery) {
          throw new ApiError(
            recovery instanceof ApiError ? recovery.code : "IO_ERROR",
            `${String(error)}; settings recovery: ${String(recovery)}`,
          );
        }
        if (active !== null) await reload(renderer, active);
        throw error;
      }
    return next;
  });
}
/** Explicit JSONC settings and one-shot shell control; idle input reaches the same show operation as the CLI. */
export const screensaver = {
  get(key?: string, options: ScreensaverOptions = {}) {
    return respond(async () => {
      const value = (await settings(screensaverContext(options))).value;
      if (key === undefined) return value;
      if (!key || key.split(".").some((part) => !part))
        throw new ApiError(
          "INVALID_ARGUMENT",
          "Screensaver keys use nonempty dot-separated segments",
        );
      let result: unknown = value;
      for (const part of key.split(".")) {
        if (!result || typeof result !== "object" || !Object.hasOwn(result, part)) return null;
        result = (result as Record<string, unknown>)[part];
      }
      return result;
    });
  },
  getConfigFile: (options: ScreensaverOptions = {}) =>
    respond(() => screensaverContext(options).configFile),
  configure: (value: unknown, options: ScreensaverOptions = {}) =>
    respond(() => configure(value, options)),
  start: (options: ScreensaverOptions = {}) => respond(() => operate("start", options)),
  show: (options: ScreensaverOptions = {}) => respond(() => operate("show", options)),
  /** Recheck native idle state when the request arrives so resumed input wins an in-flight request. */
  showIdle: (options: ScreensaverOptions = {}) => respond(() => operate("showIdle", options)),
  open: (options: ScreensaverOptions = {}) => respond(() => operate("show", options)),
  hide: (options: ScreensaverOptions = {}) => respond(() => operate("hide", options)),
  stop: (options: ScreensaverOptions = {}) => respond(() => operate("stop", options)),
  restart: (options: ScreensaverOptions = {}) => respond(() => operate("restart", options)),
  reload: (options: ScreensaverOptions = {}) => respond(() => operate("reload", options)),
  status: (options: ScreensaverOptions = {}) => respond(() => operate("status", options)),
};
