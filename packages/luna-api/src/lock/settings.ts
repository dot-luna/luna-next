import { locked, readDocument, writeFile } from "../lib/files.ts";
import { ApiError } from "../lib/response.ts";
import { validate } from "../lib/validation.ts";
import { lockContext, rendererContext, type LockContext, type LockOptions } from "./context.ts";
import { lockSettingsSchema } from "./schema.ts";
import { reload, snapshot, state } from "./runtime.ts";

export async function settings(context: LockContext) {
  const document = await readDocument(context.configFile);
  return {
    source: document.source,
    value: validate(lockSettingsSchema, document.value, context.configFile),
  };
}
export async function configure(value: unknown, options: LockOptions) {
  const context = lockContext(options);
  const patch = lockSettingsSchema.safeParse(value);
  if (!patch.success) throw new ApiError("INVALID_ARGUMENT", patch.error.message);
  return locked(context, async () => {
    const previous = await settings(context);
    const next = { ...previous.value, ...patch.data };
    const renderer = await rendererContext(context, false);
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
