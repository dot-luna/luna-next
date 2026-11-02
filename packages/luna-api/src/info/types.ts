import type { RepositoryOptions } from "../lib/repository.ts";
import type { ApiResponse } from "../lib/response.ts";

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
