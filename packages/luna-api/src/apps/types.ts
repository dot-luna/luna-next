import type { Logger } from "luna-logger";
import type { ErrorInfo } from "../response.ts";
import type { AppManifest } from "./schema.ts";
export type { AppManifest, AppExport } from "./schema.ts";

export type Source = AppManifest["source"];
export type RuntimeAction = keyof NonNullable<AppManifest["runtime"]>;
export type Hook = keyof NonNullable<AppManifest["hooks"]>;
export type Action = "install" | "uninstall" | "update" | "configure" | RuntimeAction;

export interface AppInfo {
  id: string;
  directory: string;
  manifest: AppManifest;
  capabilities: Action[];
}

export interface CommandRequest {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  /** Capture query output; ordinary command output is redirected to stderr. */
  capture?: boolean;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

export interface AppsOptions {
  /** Defaults to LUNA_NEXT_ROOT, then ~/.local/src/luna-next, resolved on each call. */
  repository?: string;
  /** Replaces the inherited environment when supplied, including HOME and PATH. */
  env?: Record<string, string>;
  logger?: Logger;
  /** Injectable process boundary; filesystem operations still use the configured paths. */
  run?: CommandRunner;
}

export interface AppStatus {
  installed: boolean;
  running: boolean | null;
}

export interface AppResult {
  app: string;
  status?: AppStatus;
}

/** A failed app may have partial effects. Completed work is never rolled back. */
export interface BatchResult {
  action: Action;
  completed: AppResult[];
  failed: { app: string; error: ErrorInfo } | null;
  unattempted: string[];
}

export interface Context {
  repository: string;
  env: Record<string, string>;
  config: string;
  data: string;
  cache: string;
  logger: Logger;
  run: CommandRunner;
}
