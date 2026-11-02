import type { InstallFailure } from "../../install/report.ts";
import type { RepositoryOptions } from "../../lib/repository.ts";
import type { ApiResponse } from "../../lib/response.ts";

export interface GitIdentity {
  name: string;
  email: string;
}

export interface InstallOptions extends RepositoryOptions {
  /** Branch or tag; latest follows the remote default branch. */
  ref?: string;
  /** install.sh already updated the checkout and published the CLI. */
  fromBootstrap?: boolean;
  skipFailed?: boolean;
  closeApps?: boolean;
  /** Explicit values replace the corresponding global Git identity settings. */
  git?: Partial<GitIdentity>;
  /** Called at the Git stage only when identity values are missing. */
  requestGitIdentity?: (current: Partial<GitIdentity>) => Promise<GitIdentity>;
  /** Human-readable progress; subprocess output is captured, never printed by the API. */
  onProgress?: (message: string) => void;
}

export interface InstallResult {
  repository: string;
  executable: string;
  cliRebuilt: boolean;
  completed: boolean;
  failed: InstallFailure[];
  logDirectory: string;
  installedApps: string[];
  installedWebapps: string[];
  pending: [];
}

export type InstallResponse = ApiResponse<InstallResult>;
