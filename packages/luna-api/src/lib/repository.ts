import { join } from "pathe";
import { ApiError } from "./response.ts";

export interface RepositoryOptions {
  /** Overrides LUNA_ROOT; otherwise the managed checkout under HOME is used. */
  repository?: string;
  /** Replaces Bun.env for this call, including HOME and LUNA_ROOT. */
  env?: Record<string, string>;
}

/** Select a path on each call without checking or creating the checkout. */
export function repositoryPath(options: RepositoryOptions): string {
  const env = options.env ?? Bun.env;
  const selected = options.repository || env.LUNA_ROOT;
  if (selected) return selected;
  if (!env.HOME) {
    throw new ApiError("INVALID_PATH", "Set LUNA_ROOT or HOME, or pass a repository path");
  }
  return join(env.HOME, ".local/src/luna-next");
}
