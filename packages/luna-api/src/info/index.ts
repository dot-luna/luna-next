import { repositoryPath } from "../lib/repository.ts";
import { respond } from "../lib/response.ts";
import { ascii } from "./ascii.ts";
import { readMetadata } from "./metadata.ts";
import type { InfoOptions, LunaInfoResponse } from "./types.ts";

/**
 * Read root package.json on every call, including after compilation, without writes or logging.
 * Missing repository selection returns INVALID_PATH, invalid metadata returns INVALID_METADATA,
 * and read failures return IO_ERROR. Project links are omitted when absent from the metadata.
 */
export function info(options: InfoOptions = {}): Promise<LunaInfoResponse> {
  return respond(async () => {
    const value = await readMetadata(repositoryPath(options));
    return {
      name: value.name,
      version: value.version,
      description: value.description,
      ascii,
      ...(value.homepage ? { homepage: value.homepage } : {}),
      ...(value.repository ? { repository: value.repository.url } : {}),
      ...(value.bugs ? { issues: value.bugs.url } : {}),
    };
  });
}
