import { validate } from "../lib/validation.ts";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "pathe";
import { ApiError } from "../lib/response.ts";
import { command, type ThemeContext } from "./context.ts";
import { metadata, parse, writeFile } from "../lib/files.ts";
import { themeModeSchema, themeSelectionSchema, validateName } from "./schema.ts";
import type { ThemeMode } from "./types.ts";
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

async function preference(context: ThemeContext) {
  const value = (
    await command(context, ["gsettings", "get", "org.gnome.desktop.interface", "color-scheme"])
  ).replace(/^'|'$/gu, "");
  if (!["default", "prefer-dark", "prefer-light"].includes(value))
    throw new ApiError("COMMAND_FAILED", `Unknown desktop appearance preference: ${value}`);
  return value;
}

async function applyPreference(context: ThemeContext, value: string) {
  await command(context, [
    "gsettings",
    "set",
    "org.gnome.desktop.interface",
    "color-scheme",
    value,
  ]);
  if ((await preference(context)) !== value)
    throw new ApiError("COMMAND_FAILED", "Desktop appearance preference was not saved");
}

export async function effectiveMode(context: ThemeContext): Promise<ThemeMode> {
  const value = await preference(context);
  if (value === "prefer-dark") return "dark";
  if (value === "prefer-light") return "light";
  return (await selection(context)).value.theme?.mode ?? (await currentTheme(context)).colors.mode;
}

/** Save before applying; recovery checks both file bytes and preference for external edits. */
export async function saveAppearance(context: ThemeContext, mode: ThemeMode, name?: string) {
  if (!themeModeSchema.safeParse(mode).success)
    throw new ApiError("INVALID_ARGUMENT", "Theme mode must be dark or light");
  const previous = await selection(context);
  const value = validate(
    themeSelectionSchema,
    { theme: { ...previous.value.theme, mode, ...(name === undefined ? {} : { name }) } },
    "Theme selection",
  );
  const next = JSON.stringify(value, null, 2) + "\n";
  const before = await preference(context);
  const target = `prefer-${mode}`;
  await writeFile(context.configFile, next, previous.source);
  if (before === target) return;
  try {
    await applyPreference(context, target);
  } catch (error) {
    const failures = [error instanceof Error ? error.message : String(error)];
    try {
      const current = await preference(context);
      if (current === target) await applyPreference(context, before);
      else if (current !== before)
        failures.push("Desktop preference changed externally; leaving it untouched");
    } catch (recovery) {
      failures.push(`Preference recovery: ${String(recovery)}`);
    }
    try {
      await writeFile(context.configFile, previous.source, next);
    } catch (recovery) {
      failures.push(`Selection recovery: ${String(recovery)}`);
    }
    throw new ApiError("COMMAND_FAILED", failures.join("; "));
  }
}
