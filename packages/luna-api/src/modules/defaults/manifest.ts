import { join, resolve } from "pathe";
import { parse, readOptional } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import type { InstallContext } from "@/modules/self/install/command.ts";
import { defaultsApplier } from "./apply.ts";
import type { DefaultEntry, DefaultsOptions } from "./context.ts";
import { desktopCatalog } from "./desktop.ts";
import { desktopPreferences } from "./preferences.ts";
import { defaultKeySchema, defaultsSchema } from "./schema.ts";
import { loginShell } from "./shell.ts";

type ManifestOptions = Pick<DefaultsOptions, "configFile" | "shellsFile">;

/** The authored manifest is only read; applying defaults never rewrites it. */
class DefaultsManifest {
  /**
   * Validate authored choices without requiring their packages to be installed yet.
   * The default path is installs/defaults.jsonc in the checkout; a missing file is INVALID_PATH.
   */
  async read({ context, configFile }: { context: InstallContext; configFile?: string }) {
    const path = resolve(configFile ?? join(context.repository, "installs/defaults.jsonc"));
    const source = await readOptional(path);
    if (source === null)
      throw new ApiError("INVALID_PATH", `Defaults manifest does not exist: ${path}`);
    return validate(defaultsSchema, parse(source, path), path);
  }

  /** Report configured and active choices without applying them. */
  async list({ context, configFile }: { context: InstallContext; configFile?: string }) {
    const configured = await this.read({ context, configFile });
    const catalog = await desktopCatalog.entries({ context, keys: Object.keys(configured) });
    const entries: DefaultEntry[] = [];
    for (const [key, value] of Object.entries(configured)) {
      const entry = catalog.get(value);
      const types = desktopCatalog.mimeTypes({ key, entry, configured });
      const current =
        key === "shell"
          ? { shell: (await loginShell.current({ context })).shell }
          : await desktopPreferences.current({ context, keys: types });
      entries.push({
        key,
        value,
        current,
        available:
          key === "shell"
            ? Boolean(loginShell.executable({ context, value }))
            : Boolean(
                entry?.available &&
                (key !== "terminal" || entry.terminal) &&
                desktopCatalog.supportedTypes({ key, entry }).length,
              ),
      });
    }
    return entries;
  }

  /** Apply selected manifest defaults; an empty key list reapplies the entire manifest. */
  async apply({
    context,
    keys = [],
    configFile,
    shellsFile,
  }: { context: InstallContext; keys?: string[] } & ManifestOptions) {
    const configured = await this.read({ context, configFile });
    return defaultsApplier.apply({
      context,
      selected: this._select({ configured, keys }),
      configured,
      shellsFile,
    });
  }

  /** Unknown or unconfigured keys fail with INVALID_ARGUMENT; duplicates are ignored. */
  private _select({ configured, keys }: { configured: Record<string, string>; keys: string[] }) {
    const selected: Record<string, string> = {};
    for (const key of keys.length ? [...new Set(keys)] : Object.keys(configured)) {
      if (!defaultKeySchema.safeParse(key).success || !Object.hasOwn(configured, key))
        throw new ApiError("INVALID_ARGUMENT", `No configured default for ${key}`);
      selected[key] = configured[key]!;
    }
    return selected;
  }
}

export const defaultsManifest = new DefaultsManifest();
