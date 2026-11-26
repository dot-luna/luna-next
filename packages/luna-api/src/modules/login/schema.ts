import { z } from "zod";
import { hasControlCharacters } from "@/lib/paths.ts";

const localPath = z
  .string()
  .min(1)
  .refine((value) => !hasControlCharacters(value), {
    message: "Use a local file path without control characters",
  });
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/u);

/** Validate authored settings without filling defaults or modifying their source. */
export const loginSettingsSchema = z.strictObject({
  screen: z.strictObject({ path: localPath.optional() }).optional(),
  theme: z
    .strictObject({
      colors: z
        .strictObject({
          background: color.optional(),
          lighter_background: color.optional(),
          foreground: color.optional(),
          bright_foreground: color.optional(),
          accent: color.optional(),
          accent_foreground: color.optional(),
          selection: color.optional(),
          selection_foreground: color.optional(),
          muted: color.optional(),
          warning: color.optional(),
          error: color.optional(),
        })
        .optional(),
      fonts: z
        .strictObject({
          ui: z
            .string()
            .min(1)
            .max(200)
            .refine((value) => Boolean(value.trim()) && !hasControlCharacters(value))
            .optional(),
        })
        .optional(),
      appearance: z
        .strictObject({
          rounding: z.number().int().min(0).max(100).optional(),
          blur: z
            .strictObject({
              enabled: z.boolean().optional(),
              size: z.number().int().positive().optional(),
              passes: z.number().int().min(1).max(10).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  background: z.strictObject({ path: localPath.optional() }).optional(),
  actions: z
    .strictObject({ shutdown_delay: z.number().int().min(0).max(2_147_483_647).optional() })
    .optional(),
  login: z
    .strictObject({
      user: z
        .string()
        .min(1)
        .refine((value) => value.trim() === value && !hasControlCharacters(value))
        .nullable()
        .optional(),
    })
    .optional(),
});

export type LoginSettings = z.infer<typeof loginSettingsSchema>;
