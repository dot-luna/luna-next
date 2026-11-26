import { z } from "zod";
import { defaults } from "./lib/defaults.ts";

// Validate the external metadata before it can become filesystem paths or download URLs.
export const githubCommitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/u) });
export const githubTreeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      mode: z.string(),
      type: z.string(),
      sha: z.string().regex(/^[a-f0-9]{40}$/u),
      size: z.number().nonnegative().optional(),
    }),
  ),
});

export const themeNameSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u);
/** Preinstalled sources in installs/themes.jsonc; relative paths resolve from the checkout. */
export const themeInstallListSchema = z
  .array(
    z.strictObject({
      name: themeNameSchema,
      source: z.string().min(1),
    }),
  )
  .refine(
    (items) => new Set(items.map((item) => item.name)).size === items.length,
    "Duplicate theme name",
  );
export const themeModeSchema = z.enum(["dark", "light"]);
// Names and file paths reach desktop clients; embedded terminal controls are invalid.
// oxlint-disable-next-line no-control-regex
const printable = /^[^\x00-\x1f\x7f]+$/u;
const text = z.string().min(1).regex(printable);
const font = text
  .max(200)
  .refine((value) => Boolean(value.trim()), "Font family must not be blank");
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/u);
const nonnegative = z.number().int().nonnegative();

export const themePackageSchema = z.strictObject({
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9@._+-]*$/u),
  source: z.enum(["pacman", "aur"]),
});

export const themeSourceSchema = z.strictObject({
  packages: z.array(themePackageSchema).optional(),
  colors: z
    .strictObject({
      ...Object.fromEntries(
        Object.keys(defaults.colors)
          .filter((key) => key !== "mode")
          .map((key) => [key, color.optional()]),
      ),
      mode: themeModeSchema.optional(),
    })
    .optional(),
  fonts: z.strictObject({ ui: font.optional(), mono: font.optional() }).optional(),
  wallpaper: z.strictObject({ sources: z.array(text).optional() }).optional(),
  appearance: z
    .strictObject({
      gaps: z
        .strictObject({ inner: nonnegative.optional(), outer: nonnegative.optional() })
        .optional(),
      border_width: nonnegative.optional(),
      rounding: nonnegative.max(100).optional(),
      opacity: z
        .strictObject({
          active: z.number().min(0).max(1).optional(),
          inactive: z.number().min(0).max(1).optional(),
          fullscreen: z.number().min(0).max(1).optional(),
        })
        .optional(),
      blur: z
        .strictObject({
          enabled: z.boolean().optional(),
          size: z.number().int().positive().optional(),
          passes: z.number().int().min(1).max(10).optional(),
        })
        .optional(),
      shadow: z
        .strictObject({
          enabled: z.boolean().optional(),
          range: nonnegative.max(100).optional(),
          falloff: z.number().int().min(1).max(4).optional(),
        })
        .optional(),
    })
    .optional(),
});

export const themeSelectionSchema = z.strictObject({
  theme: z
    .strictObject({ name: themeNameSchema.optional(), mode: themeModeSchema.optional() })
    .optional(),
});

export type ThemeMode = "dark" | "light";

/** An installed theme after defaults and derived color pairs are merged in memory. */
export interface ResolvedTheme {
  name: string;
  packages?: { name: string; source: "pacman" | "aur" }[];
  colors: Record<string, string> & { mode: ThemeMode };
  fonts: { ui: string; mono: string };
  wallpaper: { sources: string[] };
  appearance: {
    gaps: { inner: number; outer: number };
    border_width: number;
    rounding: number;
    opacity: { active: number; inactive: number; fullscreen: number };
    blur: { enabled: boolean; size: number; passes: number };
    shadow: { enabled: boolean; range: number; falloff: number };
  };
}
