import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "pathe";
import { metadata } from "../lib/files.ts";
import { ApiError } from "../lib/response.ts";

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

function path(value: string) {
  // oxlint-disable-next-line no-control-regex
  if (!value || /[\x00-\x1f\x7f]/u.test(value) || resolve(value) === "/")
    throw new ApiError(
      "INVALID_PATH",
      "Lock paths must be nonempty and cannot be the filesystem root",
    );
  return resolve(value);
}

export function lockContext(options: LockOptions = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? Bun.env))
    if (value !== undefined) env[key] = value;
  const configHome =
    env.LUNA_CONFIG_HOME_DIR ||
    (env.XDG_CONFIG_HOME
      ? join(env.XDG_CONFIG_HOME, "luna")
      : env.HOME
        ? join(env.HOME, ".config/luna")
        : undefined);
  if (configHome && !isAbsolute(configHome))
    throw new ApiError("INVALID_PATH", "Lock configuration home must be absolute");
  const file =
    options.configFile ??
    (env.LUNA_LOCK_CONFIG || (configHome ? join(configHome, "lock.jsonc") : undefined));
  if (!file) throw new ApiError("INVALID_PATH", "Set a lock config file or HOME");
  const launcher = options.launcher ?? (env.HOME ? join(env.HOME, ".local/bin/luna") : undefined);
  const repository = options.repository ? path(options.repository) : undefined;
  return {
    env,
    configFile: path(file),
    repository,
    launcher: launcher ? path(launcher) : undefined,
    shellDirectory: repository
      ? join(repository, "src/luna-lock/src/shell")
      : configHome
        ? join(configHome, "lock")
        : undefined,
  };
}
export type LockContext = ReturnType<typeof lockContext>;

export async function rendererContext(context: LockContext, requireShell = true) {
  if (
    requireShell &&
    (!context.shellDirectory ||
      !(await metadata(join(context.shellDirectory, "shell.qml")))?.isFile())
  )
    throw new ApiError(
      "INVALID_PATH",
      `Lock shell is missing: ${context.shellDirectory ?? "set HOME or a checkout"}`,
    );
  const executable =
    Bun.which("qs", { PATH: context.env.PATH }) ??
    Bun.which("quickshell", { PATH: context.env.PATH });
  if (!executable) throw new ApiError("COMMAND_FAILED", "Install Quickshell to use Luna's lock");
  if (!context.shellDirectory)
    throw new ApiError("INVALID_PATH", "Set HOME or a source checkout for Lock");
  const shellDirectory = (await metadata(context.shellDirectory))
    ? await realpath(context.shellDirectory)
    : context.shellDirectory;
  return { ...context, executable, shellDirectory };
}
export type LockRenderer = Awaited<ReturnType<typeof rendererContext>>;
