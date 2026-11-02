import { join, resolve } from "pathe";
import { appContext } from "../apps/context.ts";
import { locked, parse, readOptional, writeFile } from "../lib/files.ts";
import { ApiError, respond } from "../lib/response.ts";
import { validate } from "../lib/validation.ts";
import type { InstallContext } from "../self/install/command.ts";
import { desktopEntries, type DesktopEntry } from "./desktop.ts";
import { preparePreferenceWrites, readCurrent } from "./preferences.ts";
import { defaultKeySchema, defaultsSchema, mimeTypeSchema } from "./schema.ts";
import { currentShell, prepareShell, shellExecutable } from "./shell.ts";
import type { DefaultEntry, DefaultsOptions, DefaultsResult } from "./types.ts";

/** Validate authored choices without requiring their packages to be installed yet. */
export async function readDefaults(context: InstallContext, configFile?: string) {
  const path = resolve(configFile ?? join(context.repository, "installs/defaults.jsonc"));
  const source = await readOptional(path);
  if (source === null)
    throw new ApiError("INVALID_PATH", `Defaults manifest does not exist: ${path}`);
  return validate(defaultsSchema, parse(source, path), path);
}

function supportedTypes(key: string, entry: DesktopEntry | undefined) {
  if (!key.endsWith("/*")) return [key];
  return [...new Set(entry?.mimeTypes ?? [])]
    .filter((type) => type.startsWith(key.slice(0, -1)) && mimeTypeSchema.safeParse(type).success)
    .sort();
}

function mimeTypes(
  key: string,
  entry: DesktopEntry | undefined,
  configured: Record<string, string>,
) {
  if (!key.endsWith("/*")) return [key];
  return supportedTypes(key, entry).filter((type) => !Object.hasOwn(configured, type));
}

function selectedDefaults(configured: Record<string, string>, keys: string[]) {
  const selected: Record<string, string> = {};
  for (const key of keys.length ? [...new Set(keys)] : Object.keys(configured)) {
    if (!defaultKeySchema.safeParse(key).success || !Object.hasOwn(configured, key))
      throw new ApiError("INVALID_ARGUMENT", `No configured default for ${key}`);
    selected[key] = configured[key]!;
  }
  return selected;
}

async function applyChoices(
  context: InstallContext,
  selected: Record<string, string>,
  configured = selected,
  shellsFile?: string,
): Promise<DefaultsResult> {
  return locked(
    { configFile: join(context.env.LUNA_STATE_HOME_DIR!, "defaults"), env: context.env },
    async () => {
      const catalog = Object.keys(selected).some((key) => key !== "shell")
        ? await desktopEntries(context)
        : new Map<string, DesktopEntry>();
      const choices: Record<string, string> = {};
      let shell: Awaited<ReturnType<typeof prepareShell>> | undefined;
      // Resolve every wildcard and executable before changing either preferences or the account.
      for (const [key, value] of Object.entries(selected)) {
        if (key === "shell") {
          shell = await prepareShell(context, value, { shellsFile });
          continue;
        }
        const entry = catalog.get(value);
        if (!entry?.available)
          throw new ApiError(
            "INVALID_ARGUMENT",
            `Default ${key} requires an installed application: ${value}`,
          );
        if (key === "terminal") {
          if (!entry.terminal)
            throw new ApiError(
              "INVALID_ARGUMENT",
              `${value} must declare TerminalEmulator and [X-]TerminalArgExec`,
            );
          if (!Bun.which("xdg-terminal-exec", { PATH: context.env.PATH }))
            throw new ApiError(
              "INVALID_ENVIRONMENT",
              "Install xdg-terminal-exec before selecting a default terminal",
            );
        }
        const types = mimeTypes(key, entry, configured);
        if (!supportedTypes(key, entry).length)
          throw new ApiError(
            "INVALID_ARGUMENT",
            `${value} advertises no supported types for ${key}`,
          );
        for (const type of types) choices[type] = value;
      }
      const writes = await preparePreferenceWrites(context, choices);
      if (shell) await shell.apply();
      for (const write of writes) await writeFile(write.path, write.contents, write.previous);
      const applied = { ...choices };
      if (shell) applied.shell = shell.selected;
      return { applied };
    },
  );
}

/** Apply selected manifest defaults; an empty key list reapplies the entire manifest. */
export async function applyDefaults(
  context: InstallContext,
  keys: string[] = [],
  options: Pick<DefaultsOptions, "configFile" | "shellsFile"> = {},
) {
  const configured = await readDefaults(context, options.configFile);
  return applyChoices(context, selectedDefaults(configured, keys), configured, options.shellsFile);
}

async function operation<T>(
  options: DefaultsOptions,
  run: (context: InstallContext) => Promise<T>,
) {
  return respond(async () => {
    const context = await appContext(options);
    try {
      const result = await run(context);
      context.log.finish({ completed: true });
      return result;
    } catch (error) {
      throw context.failure(error);
    }
  });
}

export const defaults = {
  /** Read configured and active choices without applying them or rewriting the manifest. */
  list(options: DefaultsOptions = {}) {
    return operation(options, async (context): Promise<DefaultEntry[]> => {
      const configured = await readDefaults(context, options.configFile);
      const catalog = Object.keys(configured).some((key) => key !== "shell")
        ? await desktopEntries(context)
        : new Map<string, DesktopEntry>();
      const entries: DefaultEntry[] = [];
      for (const [key, value] of Object.entries(configured)) {
        const entry = catalog.get(value);
        const types = mimeTypes(key, entry, configured);
        const current =
          key === "shell"
            ? { shell: (await currentShell(context)).shell }
            : await readCurrent(context, types);
        entries.push({
          key,
          value,
          current,
          available:
            key === "shell"
              ? Boolean(shellExecutable(context, value))
              : Boolean(
                  entry?.available &&
                  (key !== "terminal" || entry.terminal) &&
                  supportedTypes(key, entry).length,
                ),
        });
      }
      return entries;
    });
  },
  /** Change active preferences only; reset restores the choices in the authored manifest. */
  set(key: string, value: string, options: DefaultsOptions = {}) {
    return operation(options, async (context) => {
      const selection = defaultsSchema.safeParse({ [key]: value });
      if (!selection.success) throw new ApiError("INVALID_ARGUMENT", selection.error.message);
      return applyChoices(context, selection.data, selection.data, options.shellsFile);
    });
  },
  reset(keys: string[] = [], options: DefaultsOptions = {}) {
    return operation(options, (context) => applyDefaults(context, keys, options));
  },
};
