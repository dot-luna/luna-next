import { locked, writeFile } from "../lib/files.ts";
import { ApiError } from "../lib/response.ts";
import type { WallpaperContext } from "./context.ts";
import { patchSettings, readSettings } from "./settings.ts";
import { rendererContext, reload, snapshot, state } from "./runtime.ts";

/** Save settings and apply them to a running renderer; recover source and active media separately. */
export function saveSettings(context: WallpaperContext, patch: unknown) {
  return locked(context, async () => {
    const previous = await readSettings(context);
    const value = patchSettings(previous.value, patch);
    const renderer = await rendererContext(context);
    const running = (await state(renderer)).running;
    const active = running ? await snapshot(renderer) : null;
    const next = JSON.stringify(value, null, 2) + "\n";
    await writeFile(context.configFile, next, previous.source);
    if (!running) return value;
    try {
      await reload(renderer, value);
    } catch (error) {
      // An external edit also prevents applying an obsolete recovery snapshot.
      try {
        await writeFile(context.configFile, previous.source, next);
      } catch (recovery) {
        throw new ApiError(
          recovery instanceof ApiError ? recovery.code : "IO_ERROR",
          `${String(error)}; settings recovery: ${String(recovery)}`,
        );
      }
      try {
        if (active !== null) await reload(renderer, active);
      } catch (recovery) {
        throw new ApiError(
          "COMMAND_FAILED",
          `${String(error)}; renderer recovery: ${String(recovery)}`,
        );
      }
      throw error;
    }
    return value;
  });
}
