import { locked, readDocument, writeFile } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import { lockContext, type LockContext } from "./context.ts";
import { lockSettingsSchema } from "./schema.ts";
import { lockRuntime } from "./runtime.ts";
import { valueAtKey } from "@/lib/keys.ts";

class LockSettingsStore {
  /** Read and validate the JSONC file, creating `{}` when it is missing. */
  async read(context: LockContext) {
    const document = await readDocument(context.configFile);
    return {
      source: document.source,
      value: validate(lockSettingsSchema, document.value, context.configFile),
    };
  }

  /** Return all settings, or the value at a dot-separated key; missing keys are null. */
  async get({ context, key }: { context: LockContext; key?: string }) {
    return valueAtKey({ value: (await this.read(context)).value, key, label: "Lock" });
  }

  /**
   * Merge a validated patch, save it, then reload a running shell. If the reload fails,
   * restore the previous file (unless it changed externally) and the shell's prior settings.
   */
  async configure({ context, value }: { context: LockContext; value: unknown }) {
    const patch = lockSettingsSchema.safeParse(value);
    if (!patch.success) throw new ApiError("INVALID_ARGUMENT", patch.error.message);
    return locked(context, async () => {
      const previous = await this.read(context);
      const next = { ...previous.value, ...patch.data };
      const renderer = await lockContext.renderer({ context, requireShell: false });
      const running = (await lockRuntime.state(renderer)).running;
      const active = running ? await lockRuntime.snapshot(renderer) : null;
      const source = JSON.stringify(next, null, 2) + "\n";
      await writeFile(context.configFile, source, previous.source);
      if (running)
        try {
          await lockRuntime.reload({ context: renderer, settings: next });
        } catch (error) {
          try {
            await writeFile(context.configFile, previous.source, source);
          } catch (recovery) {
            throw new ApiError(
              recovery instanceof ApiError ? recovery.code : "IO_ERROR",
              `${String(error)}; settings recovery: ${String(recovery)}`,
            );
          }
          if (active !== null) await lockRuntime.reload({ context: renderer, settings: active });
          throw error;
        }
      return next;
    });
  }
}

export const lockSettings = new LockSettingsStore();
