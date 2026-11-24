import { z } from "zod";

// Paths reach Qt and native players; do not let control bytes become arguments or URLs.
const source = z
  .string()
  // oxlint-disable-next-line no-control-regex
  .regex(/^[^\x00-\x1f\x7f]*$/u)
  .refine(
    (value) => value === "" || value.startsWith("/"),
    "Use an absolute local media path, or an empty string",
  );

/** Sparse settings retain unknown fields; renderer defaults never enter the source document. */
export const wallpaperSettingsSchema = z.looseObject({
  wallpaper: z
    .looseObject({
      source: source.optional(),
      fit: z.enum(["fill", "fit", "stretch", "center", "tile"]).optional(),
      background_color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/u)
        .optional(),
    })
    .optional(),
  playback: z.looseObject({ pause_when_output_inactive: z.boolean().optional() }).optional(),
  transition: z
    .looseObject({
      type: z.enum(["none", "fade"]).optional(),
      duration_ms: z.number().int().min(0).max(2147483647).optional(),
    })
    .optional(),
});

export type WallpaperSettings = z.infer<typeof wallpaperSettingsSchema>;

// oxlint-disable-next-line no-control-regex
const filenameControls = /[\x00-\x1f\x7f]/u;
export const wallpaperNameSchema = z
  .string()
  .min(1)
  .refine(
    (name) =>
      Boolean(name.trim()) &&
      !name.includes("/") &&
      !name.includes("\\") &&
      name !== "." &&
      name !== ".." &&
      !name.startsWith(".luna-") &&
      name !== ".library" &&
      name !== ".library.lock",
    "Wallpaper names must be ordinary single filenames",
  )
  .refine((name) => !filenameControls.test(name), "Wallpaper names cannot contain controls");

export const wallpaperImportSchema = z.object({
  sources: z.array(z.string().min(1)).min(1),
  name: wallpaperNameSchema.optional(),
  recursive: z.boolean().optional(),
});
