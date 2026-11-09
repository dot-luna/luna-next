import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { uptime } from "node:os";
import { ApiError } from "../lib/response.ts";
import { runCommand } from "./command.ts";

export interface HardwareCommand {
  argv: string[];
  timeoutMs: number;
}

export interface HardwareCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface HardwareFileMetadata {
  uid: number;
  mode: number;
  kind: "file" | "directory" | "other";
}

/** Internal I/O boundary for isolated tests; it is not exported by @luna/api. */
export interface HardwareContext {
  platform: string;
  readText(path: string): Promise<string>;
  listNames(path: string): Promise<string[]>;
  realPath(path: string): Promise<string>;
  metadata(path: string): Promise<HardwareFileMetadata>;
  run(command: HardwareCommand): Promise<HardwareCommandResult>;
  now(): number;
  /** Host uptime makes a request deadline comparable across the pkexec process boundary. */
  monotonicMs(): number;
}

// Constructing this context performs no reads, subprocesses, or timer registration.
export const systemContext: HardwareContext = {
  platform: process.platform,
  readText: (path) => readFile(path, "utf8"),
  listNames: (path) => readdir(path),
  realPath: (path) => realpath(path),
  async metadata(path) {
    const value = await stat(path);
    return {
      uid: value.uid,
      mode: value.mode,
      kind: value.isFile() ? "file" : value.isDirectory() ? "directory" : "other",
    };
  },
  run: runCommand,
  now: Date.now,
  monotonicMs: () => Math.floor(uptime() * 1000),
};

export function requireLinux(context: HardwareContext): void {
  if (context.platform !== "linux")
    throw new ApiError("INVALID_ENVIRONMENT", "Luna Hardware requires Linux");
}

export function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Absence is distinct from unreadable files: permissions and I/O errors still propagate. */
export async function optionalText(context: HardwareContext, path: string): Promise<string | null> {
  try {
    return (await context.readText(path)).trim();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
