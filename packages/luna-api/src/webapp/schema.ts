import { z } from "zod";

// Desktop names and URLs must not inject lines or terminal controls.
// oxlint-disable-next-line no-control-regex
const printable = /^[^\x00-\x1f\x7f]+$/u;
export const webappNameSchema = z
  .string()
  .trim()
  .min(1)
  .regex(printable)
  .refine(
    (name) => Buffer.byteLength(name, "utf8") <= 100,
    "Web app name must be at most 100 UTF-8 bytes",
  );
export const webappUrlSchema = z
  .string()
  .trim()
  .regex(printable)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  }, "Use an HTTP(S) URL without credentials")
  .transform((value) => new URL(value).href);
export const webappRecipeSchema = z.strictObject({ name: webappNameSchema, url: webappUrlSchema });
export const webappRecordSchema = webappRecipeSchema.extend({
  id: z.string().regex(/^luna-webapp-[0-9a-f]+$/u),
});
export const webappManifestSchema = z.object({
  icons: z
    .array(
      z
        .object({
          src: z.string(),
          purpose: z.string().optional(),
        })
        .nullable()
        .catch(null),
    )
    .catch([]),
});
export type WebappRecord = z.infer<typeof webappRecordSchema>;
export const webappCatalogSchema = z.array(webappRecipeSchema).superRefine((values, context) => {
  const names = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (names.has(value.name))
      context.addIssue({
        code: "custom",
        message: `Duplicate web app: ${value.name}`,
        path: [index, "name"],
      });
    names.add(value.name);
  }
});
