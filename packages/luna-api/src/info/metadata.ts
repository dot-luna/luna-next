import { join } from "pathe";
import { z } from "zod";
import { ApiError } from "../lib/response.ts";

const metadataSchema = z.object({
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

/** Read only the root package fields needed for info; ignore unrelated package settings. */
export async function readMetadata(repository: string) {
  const path = join(repository, "package.json");
  const text = await Bun.file(path).text();
  let metadata: unknown;
  try {
    metadata = JSON.parse(text);
  } catch {
    throw new ApiError("INVALID_METADATA", `Root package metadata must be JSON: ${path}`);
  }
  const parsed = metadataSchema.safeParse(metadata);
  if (!parsed.success) {
    throw new ApiError(
      "INVALID_METADATA",
      `Invalid root package metadata in ${path}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
