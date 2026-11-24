import { z } from "zod";

export const desktopIdSchema = z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.+-]*\.desktop$/u);
export const mimeTypeSchema = z.string().regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/u);
export const defaultKeySchema = z
  .string()
  .refine(
    (key) =>
      ["terminal", "shell", "image/*", "audio/*", "video/*"].includes(key) ||
      mimeTypeSchema.safeParse(key).success,
    "Use terminal, shell, an exact MIME type, or image/*, audio/*, video/*",
  );
const shellSchema = z
  .string()
  // oxlint-disable-next-line no-control-regex
  .regex(/^(?:\/(?:[^\s\x00-\x1f\x7f/]+\/)*[^\s\x00-\x1f\x7f/]+|[a-zA-Z0-9_][a-zA-Z0-9_.+-]*)$/u);

/** Native application choices use desktop IDs; login shells use executable names or paths. */
export const defaultsSchema = z
  .record(defaultKeySchema, z.string())
  .superRefine((values, context) => {
    for (const [key, value] of Object.entries(values)) {
      const result = (key === "shell" ? shellSchema : desktopIdSchema).safeParse(value);
      if (!result.success)
        context.addIssue({
          code: "custom",
          path: [key],
          message:
            key === "shell"
              ? "Use a shell executable name or absolute path"
              : "Use a desktop entry ID ending in .desktop",
        });
    }
  });
