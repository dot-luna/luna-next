import { z } from "zod";
import { defaults } from "./defaults.ts";
import { ApiError } from "../lib/response.ts";

export const themeNameSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u);
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

export const themeSourceSchema = z.strictObject({
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

export function validate<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError("INVALID_METADATA", `${label}: ${result.error.message}`);
  return result.data;
}

export function validateName(value: string) {
  if (!themeNameSchema.safeParse(value).success)
    throw new ApiError(
      "INVALID_ARGUMENT",
      "Theme names use lowercase letters, digits, underscores and hyphens",
    );
  return value;
}
