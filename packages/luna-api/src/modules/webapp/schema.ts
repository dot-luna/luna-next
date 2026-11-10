import { z } from "zod";

// Desktop fields must not introduce new lines or terminal control characters.
// oxlint-disable-next-line no-control-regex
const printableCharacters = /^[^\x00-\x1f\x7f]+$/u;
const urlScheme = /^[a-z][a-z0-9+.-]*:/iu;

/** Trim display names and limit their UTF-8 length so encoded app IDs fit filenames. */
export const webappNameSchema = z
  .string()
  .trim()
  .min(1)
  .regex(printableCharacters)
  .refine(
    (name) => Buffer.byteLength(name, "utf8") <= 100,
    "Web app name must be at most 100 UTF-8 bytes",
  );

/** Normalize HTTP(S) URLs and reject embedded credentials. */
export const webappUrlSchema = z
  .string()
  .trim()
  .regex(printableCharacters)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use an HTTP(S) URL without credentials")
  .transform((value) => new URL(value).href);

// Keep local paths literal; unsupported URL schemes must not be treated as filenames.
const localIconPathSchema = z
  .string()
  .min(1)
  .regex(printableCharacters)
  .refine((path) => !urlScheme.test(path.trim()), "Use a local path or an HTTP(S) URL");

/** Validate a local file path or a direct HTTP(S) image URL without reading its contents. */
export const webappIconSourceSchema = z.union([webappUrlSchema, localIconPathSchema]);

const webappDetailsSchema = z.strictObject({ name: webappNameSchema, url: webappUrlSchema });

/** Install inputs; omitting icon enables automatic discovery from the website. */
export const webappRecipeSchema = webappDetailsSchema.extend({
  icon: webappIconSourceSchema.optional(),
});

/** Saved app identity excludes the original icon source; installation owns a separate copy. */
export const webappRecordSchema = webappDetailsSchema.extend({
  id: z.string().regex(/^luna-webapp-[0-9a-f]+$/u),
});

/** Launch defaults reuse an open window and allow abbreviated app names. */
export const webappLaunchSettingsSchema = z.object({
  /** Focus an existing window; false requests a new window without checking the compositor. */
  focusExisting: z.boolean().default(true),
  /** Fall back to fzf name matching when the supplied name is not an exact installed name. */
  fuzzy: z.boolean().default(true),
});

/** Read only the Hyprland client fields needed to identify and focus an app window. */
export const webappWindowsSchema = z.array(z.object({
  address: z.string().regex(/^0x[0-9a-f]+$/iu),
  class: z.string(),
  initialClass: z.string().optional(),
  pid: z.number().int(),
  mapped: z.boolean().optional(),
  focusHistoryID: z.number().int().optional(),
}));

// Ignore individual malformed manifest icons without discarding other usable candidates.
const manifestIconSchema = z
  .object({ src: z.string(), purpose: z.string().optional() })
  .nullable()
  .catch(null);

/** Read only icon fields from a site's manifest; missing or invalid icon arrays are empty. */
export const webappManifestSchema = z.object({
  icons: z.array(manifestIconSchema).catch([]),
});

/** Reject repeated normalized display names before setup starts installing web apps. */
export const webappCatalogSchema = z.array(webappDetailsSchema).superRefine((apps, context) => {
  const seenNames = new Set<string>();
  for (const [index, app] of apps.entries()) {
    if (seenNames.has(app.name))
      context.addIssue({
        code: "custom",
        message: `Duplicate web app: ${app.name}`,
        path: [index, "name"],
      });
    seenNames.add(app.name);
  }
});

export type WebappRecipe = z.infer<typeof webappRecipeSchema>;
export type WebappRecord = z.infer<typeof webappRecordSchema>;
export type WebappLaunchSettings = z.input<typeof webappLaunchSettingsSchema>;
