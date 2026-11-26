import { repositoryPath, type RepositoryOptions } from "@/lib/repository.ts";
import { respond, type ApiResponse } from "@/lib/response.ts";
import { ascii } from "./ascii.ts";
import { packageMetadata } from "./metadata.ts";

export type InfoOptions = RepositoryOptions;

/** Repository identity from root package.json, with optional project links and the Luna banner. */
export interface LunaInfo {
  name: string;
  version: string;
  description: string;
  ascii: string;
  homepage?: string;
  repository?: string;
  issues?: string;
}

export type LunaInfoResponse = ApiResponse<LunaInfo>;

/**
 * Read root package.json on every call, including after compilation, without writes or logging.
 * Missing repository selection returns INVALID_PATH, invalid metadata returns INVALID_METADATA,
 * and read failures return IO_ERROR. Project links are omitted when absent from the metadata.
 * `Luna.info` is callable directly, so this stays a function rather than a facade object.
 */
export function info(options: InfoOptions = {}): Promise<LunaInfoResponse> {
  return respond(async () => {
    const value = await packageMetadata.read(repositoryPath(options));
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
