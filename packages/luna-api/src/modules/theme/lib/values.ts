import { readFile } from "node:fs/promises";
import { join } from "pathe";
import { metadata, parse } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import { defaults, lightColors } from "./defaults.ts";
import { themeSourceSchema, type ResolvedTheme } from "../schema.ts";
import { valueAtKey } from "@/lib/keys.ts";

/** Roles whose foreground is derived for contrast when a theme sets only the fill. */
const foregroundRoles = [
  "accent",
  "selection",
  "secondary_accent",
  "error",
  "warning",
  "notice",
  "success",
  "info",
];
/** Roles whose emphasis falls back to the authored base color. */
const emphasisRoles = ["secondary_accent", "error", "warning", "success", "info", "link"];

class ThemeValues {
  /** Locate the single JSON/JSONC manifest; ambiguous folders are rejected. */
  async manifest(directory: string) {
    const paths = [];
    for (const name of ["theme.jsonc", "theme.json"])
      if ((await metadata(join(directory, name)))?.isFile()) paths.push(join(directory, name));
    if (paths.length !== 1)
      throw new ApiError(
        "INVALID_METADATA",
        "Theme folders need exactly one theme.json or theme.jsonc",
      );
    return paths[0]!;
  }

  parse(source: string, path: string) {
    return validate(themeSourceSchema, parse(source, path), path);
  }

  /** Read the authored manifest without applying defaults or rewriting its bytes. */
  async read(directory: string) {
    const path = await this.manifest(directory);
    const source = await readFile(path, "utf8");
    return this.parse(source, path);
  }

  /** Defaults and derived pairs are resolved in memory; authored JSONC is never rewritten. */
  resolve({ source, name }: { source: unknown; name: string }): ResolvedTheme {
    const original = validate(themeSourceSchema, source, "Invalid theme");
    const value = structuredClone(defaults);
    if (original.colors?.mode === "light") Object.assign(value.colors, lightColors);
    this._merge(value as unknown as Record<string, unknown>, original);
    const colors = original.colors as Record<string, string> | undefined;
    for (const role of foregroundRoles)
      if (colors?.[role] && colors[`${role}_foreground`] === undefined)
        value.colors[`${role}_foreground`] = this._readableForeground(colors[role]);
    for (const role of emphasisRoles)
      if (colors?.[role] && colors[`${role}_emphasis`] === undefined)
        value.colors[`${role}_emphasis`] = colors[role];
    validate(themeSourceSchema, value, "Resolved theme");
    return { ...value, name };
  }

  /** Return the value at a dot-separated key, or null when any segment is absent. */
  lookup({ theme, key }: { theme: ResolvedTheme; key?: string }): unknown {
    return valueAtKey({ value: theme, key, label: "Theme" });
  }

  /** Merge objects recursively; arrays and scalars replace defaults. */
  private _merge(target: Record<string, unknown>, source: Record<string, unknown>) {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === "object" && !Array.isArray(value))
        this._merge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
      else target[key] = value;
    }
  }

  /** Pick black or white by the higher WCAG contrast ratio against the fill. */
  private _readableForeground(fill: string) {
    const luminance = [0.2126, 0.7152, 0.0722].reduce((total, weight, index) => {
      const channel = Number.parseInt(fill.slice(1 + index * 2, 3 + index * 2), 16) / 255;
      return (
        total + weight * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      );
    }, 0);
    return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
  }
}

export const themeValues = new ThemeValues();
