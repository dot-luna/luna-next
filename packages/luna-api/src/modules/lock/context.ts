import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "pathe";
import { environment, lunaConfigHome } from "@/lib/env.ts";
import { metadata } from "@/lib/files.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { quickshell, type QuickshellContext } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";

export interface LockOptions {
  env?: Record<string, string>;
  configFile?: string;
  /** Select source QML instead of the installed shell. */
  repository?: string;
  /** CLI used by native idle events; defaults to ~/.local/bin/luna. */
  launcher?: string;
}
export interface LockState {
  running: boolean;
  status: "stopped" | "idle" | "locking" | "locked";
  shellDirectory: string;
  configFile: string;
}

/** Validated per-call paths; shellDirectory is undefined without HOME or a checkout. */
export interface LockContext {
  env: Record<string, string>;
  configFile: string;
  repository?: string;
  launcher?: string;
  shellDirectory?: string;
}

/** A lock context whose Quickshell executable and shell directory are resolved. */
export interface LockRenderer extends LockContext, QuickshellContext {
  shellDirectory: string;
}

class LockContextResolver {
  /** Resolve fresh paths without touching the filesystem; caller env is copied, never retained. */
  resolve(options: LockOptions = {}): LockContext {
    const env = environment(options.env);
    const configHome = lunaConfigHome(env);
    if (configHome && !isAbsolute(configHome))
      throw new ApiError("INVALID_PATH", "Lock configuration home must be absolute");
    const file =
      options.configFile ??
      (env.LUNA_LOCK_CONFIG || (configHome ? join(configHome, "lock.jsonc") : undefined));
    if (!file) throw new ApiError("INVALID_PATH", "Set a lock config file or HOME");
    const launcher = options.launcher ?? (env.HOME ? join(env.HOME, ".local/bin/luna") : undefined);
    const repository = options.repository ? this._path(options.repository) : undefined;
    return {
      env,
      configFile: this._path(file),
      repository,
      launcher: launcher ? this._path(launcher) : undefined,
      shellDirectory: repository
        ? join(repository, "src/luna-lock/src/shell")
        : configHome
          ? join(configHome, "lock")
          : undefined,
    };
  }

  /**
   * Find Quickshell and canonicalize the shell directory. Starting operations require
   * shell.qml; control operations do not, so they can still reach a running shell.
   */
  async renderer({
    context,
    requireShell = true,
  }: {
    context: LockContext;
    requireShell?: boolean;
  }): Promise<LockRenderer> {
    if (
      requireShell &&
      (!context.shellDirectory ||
        !(await metadata(join(context.shellDirectory, "shell.qml")))?.isFile())
    )
      throw new ApiError(
        "INVALID_PATH",
        `Lock shell is missing: ${context.shellDirectory ?? "set HOME or a checkout"}`,
      );
    const executable = quickshell.executable({ env: context.env, feature: "Luna's lock" });
    if (!context.shellDirectory)
      throw new ApiError("INVALID_PATH", "Set HOME or a source checkout for Lock");
    const shellDirectory = (await metadata(context.shellDirectory))
      ? await realpath(context.shellDirectory)
      : context.shellDirectory;
    return { ...context, executable, shellDirectory };
  }

  private _path(value: string) {
    if (!value || hasControlCharacters(value) || resolve(value) === "/")
      throw new ApiError(
        "INVALID_PATH",
        "Lock paths must be nonempty and cannot be the filesystem root",
      );
    return resolve(value);
  }
}

export const lockContext = new LockContextResolver();
