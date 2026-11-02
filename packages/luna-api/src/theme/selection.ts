import { validate } from "../lib/validation.ts";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "pathe";
import { ApiError } from "../lib/response.ts";
import { type ThemeContext } from "./context.ts";
import { metadata, parse, writeFile } from "../lib/files.ts";
import { gsettings } from "./gsettings.ts";
import { prepareGtkTheme, publishGtkTheme, restoreGtkTheme } from "./gtk.ts";
import { themeModeSchema, themeSelectionSchema, validateName } from "./schema.ts";
import type { ResolvedTheme, ThemeMode } from "./types.ts";
import { readTheme, resolveTheme } from "./values.ts";

export async function selection(context: ThemeContext) {
  await mkdir(dirname(context.configFile), { recursive: true });
  try {
    const file = await open(context.configFile, "wx", 0o600);
    try {
      await file.writeFile("{}\n");
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const source = await readFile(context.configFile, "utf8");
  return {
    source,
    value: validate(themeSelectionSchema, parse(source, context.configFile), context.configFile),
  };
}

export async function themePath(context: ThemeContext, name: string) {
  const path = join(context.libraryDir, validateName(name));
  if (!(await metadata(path))?.isDirectory())
    throw new ApiError("INVALID_PATH", `Installed theme must be a regular directory: ${path}`);
  return path;
}

export async function inspectTheme(context: ThemeContext, name: string) {
  return resolveTheme(await readTheme(await themePath(context, name)), name);
}

export async function currentTheme(context: ThemeContext) {
  const name = (await selection(context)).value.theme?.name;
  return name ? inspectTheme(context, name) : resolveTheme({}, "tokyo-night");
}

type PreferenceKey = "color-scheme" | "gtk-theme";

async function preference(context: ThemeContext, key: PreferenceKey = "color-scheme") {
  // Keep GVariant literals intact so quoted or escaped GTK names survive recovery.
  const value = await gsettings(context, ["get", "org.gnome.desktop.interface", key]);
  if (key === "color-scheme" && !["'default'", "'prefer-dark'", "'prefer-light'"].includes(value))
    throw new ApiError("COMMAND_FAILED", `Unknown desktop appearance preference: ${value}`);
  return value;
}

async function applyPreference(context: ThemeContext, key: PreferenceKey, value: string) {
  await gsettings(context, ["set", "org.gnome.desktop.interface", key, value]);
  if ((await preference(context, key)) !== value)
    throw new ApiError("COMMAND_FAILED", `Desktop ${key} preference was not saved`);
}

export async function effectiveMode(context: ThemeContext): Promise<ThemeMode> {
  const value = await preference(context);
  if (value === "'prefer-dark'") return "dark";
  if (value === "'prefer-light'") return "light";
  return (await selection(context)).value.theme?.mode ?? (await currentTheme(context)).colors.mode;
}

/** Publish GTK colors and desktop mode with selection; recover only unchanged writes. */
export async function saveAppearance(
  context: ThemeContext,
  mode: ThemeMode,
  theme?: ResolvedTheme,
) {
  if (!themeModeSchema.safeParse(mode).success)
    throw new ApiError("INVALID_ARGUMENT", "Theme mode must be dark or light");
  const previous = await selection(context);
  const value = validate(
    themeSelectionSchema,
    { theme: { ...previous.value.theme, mode, ...(theme ? { name: theme.name } : {}) } },
    "Theme selection",
  );
  const name = previous.value.theme?.name;
  const resolved =
    theme ?? (name ? await inspectTheme(context, name) : resolveTheme({}, "tokyo-night"));
  const gtkBefore = await preference(context, "gtk-theme");
  const gtk = await prepareGtkTheme(context, resolved, mode, gtkBefore);
  const next = JSON.stringify(value, null, 2) + "\n";
  const changes: { key: PreferenceKey; before: string; target: string }[] = [];
  for (const [key, target] of [
    ["color-scheme", `'prefer-${mode}'`],
    ["gtk-theme", `'${gtk.name}'`],
  ] as const) {
    const before = key === "gtk-theme" ? gtkBefore : await preference(context, key);
    if (before !== target) changes.push({ key, before, target });
  }
  await writeFile(context.configFile, next, previous.source);
  const attempted: typeof changes = [];
  try {
    await publishGtkTheme(gtk);
    for (const change of changes) {
      if ((await preference(context, change.key)) !== change.before)
        throw new ApiError("CONFLICT", `Desktop ${change.key} preference changed externally`);
      // A failed command can still save its value, so include it in recovery before calling.
      attempted.push(change);
      await applyPreference(context, change.key, change.target);
    }
  } catch (error) {
    const failures = [error instanceof Error ? error.message : String(error)];
    for (const change of attempted.reverse()) {
      try {
        const current = await preference(context, change.key);
        if (current === change.target) await applyPreference(context, change.key, change.before);
        else if (current !== change.before)
          failures.push(
            `Desktop ${change.key} preference changed externally; leaving it untouched`,
          );
      } catch (recovery) {
        failures.push(`${change.key} recovery: ${String(recovery)}`);
      }
    }
    try {
      if (
        gtk.source !== gtk.contents &&
        (await preference(context, "gtk-theme")) === `'${gtk.name}'`
      )
        failures.push("GTK theme remains selected; retaining its generated stylesheet");
      else await restoreGtkTheme(gtk);
    } catch (recovery) {
      failures.push(`GTK theme recovery: ${String(recovery)}`);
    }
    try {
      await writeFile(context.configFile, previous.source, next);
    } catch (recovery) {
      failures.push(`Selection recovery: ${String(recovery)}`);
    }
    throw new ApiError("COMMAND_FAILED", failures.join("; "));
  }
}
