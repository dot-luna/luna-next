import { z } from "zod";

/** OCR is English-only; sparse source settings receive defaults only at capture time. */
export const screenshotSettingsSchema = z.object({
  text: z
    .object({
      layout: z.enum(["block", "line", "sparse"]).optional(),
      preserve_spaces: z.boolean().optional(),
    })
    .optional(),
});
