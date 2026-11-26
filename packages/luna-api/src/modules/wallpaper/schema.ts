import { z } from "zod";
import { hasControlCharacters } from "@/lib/paths.ts";

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
  watch_config: z.boolean().optional(),
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
});

export type WallpaperSettings = z.infer<typeof wallpaperSettingsSchema>;

/** Reserved names keep library locks and staging directories out of user selections. */
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
  .refine((name) => !hasControlCharacters(name), "Wallpaper names cannot contain controls");

export const wallpaperImportSchema = z.object({
  sources: z.array(z.string().min(1)).min(1),
  name: wallpaperNameSchema.optional(),
  recursive: z.boolean().optional(),
});
