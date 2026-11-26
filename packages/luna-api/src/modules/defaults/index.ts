import { ApiError, respond } from "@/lib/response.ts";
import { appContext } from "@/modules/apps/context.ts";
import type { InstallContext } from "@/modules/self/install/command.ts";
import { defaultsApplier } from "./apply.ts";
import type { DefaultsOptions } from "./context.ts";
import { defaultsManifest } from "./manifest.ts";
import { defaultsSchema } from "./schema.ts";

/** Desktop applications, the terminal and the login shell chosen by Luna's defaults manifest. */
class Defaults {
  /** Read configured and active choices without applying them or rewriting the manifest. */
  list(options: DefaultsOptions = {}) {
    return this._run(options, (context) =>
      defaultsManifest.list({ context, configFile: options.configFile }),
    );
  }

  /** Change active preferences only; reset restores the choices in the authored manifest. */
  set(key: string, value: string, options: DefaultsOptions = {}) {
    return this._run(options, async (context) => {
      const selection = defaultsSchema.safeParse({ [key]: value });
      if (!selection.success) throw new ApiError("INVALID_ARGUMENT", selection.error.message);
      return defaultsApplier.apply({
        context,
        selected: selection.data,
        shellsFile: options.shellsFile,
      });
    });
  }

  /** Reapply manifest choices for keys, or for the whole manifest when keys is empty. */
  reset(keys: string[] = [], options: DefaultsOptions = {}) {
    return this._run(options, (context) =>
      defaultsManifest.apply({
        context,
        keys,
        configFile: options.configFile,
        shellsFile: options.shellsFile,
      }),
    );
  }

  /** Resolve the apps context and record completion or failure in its install log. */
  private _run<T>(options: DefaultsOptions, run: (context: InstallContext) => Promise<T>) {
    return respond(async () => {
      const context = await appContext.resolve(options);
      try {
        const result = await run(context);
        context.log.finish({ completed: true });
        return result;
      } catch (error) {
        throw context.failure(error);
      }
    });
  }
}

export const defaults = new Defaults();
