import { z } from "zod";

/** Only the root package fields info reports; unrelated package settings are ignored. */
export const packageMetadataSchema = z.object({
  name: z.string().trim().min(1),
  version: z
    .string()
    .trim()
    .min(1)
    .regex(/^[0-9A-Za-z.+-]+$/u),
  description: z.string().trim().min(1),
  homepage: z.url().optional(),
  repository: z.object({ url: z.url() }).optional(),
  bugs: z.object({ url: z.url() }).optional(),
});
