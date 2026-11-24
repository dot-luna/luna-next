import { locked, readDocument, writeFile } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import { screensaverContext, type ScreensaverContext } from "./context.ts";
import { screensaverSettingsSchema } from "./schema.ts";
import { screensaverRuntime } from "./runtime.ts";

class ScreensaverSettingsStore {
  /** Read and validate the JSONC file, creating `{}` when it is missing. */
  async read(context: ScreensaverContext) {
    const document = await readDocument(context.configFile);
    return {
      source: document.source,
      value: validate(screensaverSettingsSchema, document.value, context.configFile),
    };
  }

  /** Return all settings, or the value at a dot-separated key; missing keys are null. */
  async get({ context, key }: { context: ScreensaverContext; key?: string }) {
    const value = (await this.read(context)).value;
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
  }

  /**
   * Merge a validated patch, save it, then reload a running shell. If the reload fails,
   * restore the previous file (unless it changed externally) and the shell's prior settings.
   * Requires the shell to be installed even when it is not running.
   */
  async configure({ context, value }: { context: ScreensaverContext; value: unknown }) {
    const patch = screensaverSettingsSchema.safeParse(value);
    if (!patch.success) throw new ApiError("INVALID_ARGUMENT", patch.error.message);
    return locked(context, async () => {
      const previous = await this.read(context);
      const next = { ...previous.value, ...patch.data };
      const renderer = await screensaverContext.renderer(context);
      const running = (await screensaverRuntime.state(renderer)).running;
      const active = running ? await screensaverRuntime.snapshot(renderer) : null;
      const source = JSON.stringify(next, null, 2) + "\n";
      await writeFile(context.configFile, source, previous.source);
      if (running)
        try {
          await screensaverRuntime.reload({ context: renderer, settings: next });
        } catch (error) {
          try {
            await writeFile(context.configFile, previous.source, source);
          } catch (recovery) {
            throw new ApiError(
              recovery instanceof ApiError ? recovery.code : "IO_ERROR",
              `${String(error)}; settings recovery: ${String(recovery)}`,
            );
          }
          if (active !== null)
            await screensaverRuntime.reload({ context: renderer, settings: active });
          throw error;
        }
      return next;
    });
  }
}

export const screensaverSettings = new ScreensaverSettingsStore();
