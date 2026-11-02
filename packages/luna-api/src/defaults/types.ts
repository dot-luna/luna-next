import type { RepositoryOptions } from "../lib/repository.ts";

export interface DefaultsOptions extends RepositoryOptions {
  /** Defaults manifest; otherwise installs/defaults.jsonc in the selected checkout. */
  configFile?: string;
  /** Registered login shells; defaults to /etc/shells. */
  shellsFile?: string;
  onProgress?: (message: string) => void;
}

export interface DefaultEntry {
  key: string;
  value: string;
  /** Exact MIME types for wildcard groups; terminal and shell use their own key. */
  current: Record<string, string | null>;
  available: boolean;
}

export interface DefaultsResult {
  /** Wildcards are expanded into exact MIME types before preferences are saved. */
  applied: Record<string, string>;
}
