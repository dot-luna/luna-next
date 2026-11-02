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
  /** Deferred stages are reported so partial setup cannot look like a full desktop install. */
  pending: ("apps" | "later" | "webapps")[];
}

export type InstallResponse = ApiResponse<InstallResult>;
