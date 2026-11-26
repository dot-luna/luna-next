import { join } from "pathe";
import { ApiError } from "@/lib/response.ts";
import { packageMetadataSchema } from "./schema.ts";

class PackageMetadata {
  /** Read the checkout's root package.json; malformed JSON or fields throw INVALID_METADATA. */
  async read(repository: string) {
    const path = join(repository, "package.json");
    const text = await Bun.file(path).text();
    let metadata: unknown;
    try {
      metadata = JSON.parse(text);
    } catch {
      throw new ApiError("INVALID_METADATA", `Root package metadata must be JSON: ${path}`);
    }
    const parsed = packageMetadataSchema.safeParse(metadata);
    if (!parsed.success)
      throw new ApiError(
        "INVALID_METADATA",
        `Invalid root package metadata in ${path}: ${parsed.error.message}`,
      );
    return parsed.data;
  }
}

export const packageMetadata = new PackageMetadata();
