import { realpath } from "node:fs/promises";
import { isAbsolute, join } from "pathe";
import { metadata } from "../lib/files.ts";
import { ApiError } from "../lib/response.ts";

export interface MenuOptions {
  /** Select source QML from this checkout instead of the installed menu. */
  repository?: string;
  /** Replaces Bun.env for runtime paths, theme selection, and child processes. */
  env?: Record<string, string>;
}
export interface MenuState {
  running: boolean;
  shellDirectory: string;
}

export async function menuContext(options: MenuOptions) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? Bun.env))
    if (value !== undefined) env[key] = value;
  const config =
    env.LUNA_CONFIG_HOME_DIR ||
    (env.XDG_CONFIG_HOME
      ? join(env.XDG_CONFIG_HOME, "luna")
      : env.HOME
        ? join(env.HOME, ".config/luna")
        : undefined);
  const shell = options.repository
    ? join(options.repository, "src/luna-menu/src/shell")
    : config
      ? join(config, "menu")
      : undefined;
  // oxlint-disable-next-line no-control-regex
  if (!shell || !isAbsolute(shell) || /[\x00-\x1f\x7f]/u.test(shell))
    throw new ApiError(
      "INVALID_PATH",
      "The menu requires an absolute configuration or checkout path",
    );
  if (!(await metadata(join(shell, "shell.qml")))?.isFile())
    throw new ApiError("INVALID_PATH", `Menu shell is missing: ${shell}`);
  const executable =
    Bun.which("qs", { PATH: env.PATH }) ?? Bun.which("quickshell", { PATH: env.PATH });
  if (!executable) throw new ApiError("COMMAND_FAILED", "Install Quickshell to use Luna's menu");
  return { env, executable, shellDirectory: await realpath(shell) };
}

export type MenuContext = Awaited<ReturnType<typeof menuContext>>;

/** Config-scoped commands cannot control a different Quickshell application. */
export async function command(context: MenuContext, args: string[], allowFailure = false) {
  const child = Bun.spawn([context.executable, ...args], {
    env: context.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 && !allowFailure)
    throw new ApiError(
      "COMMAND_FAILED",
      `Menu command failed (${code}): ${(stderr || stdout).trim()}`,
    );
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

export function ipc(context: MenuContext, method: string, allowFailure = false) {
  // show is also a Quickshell CLI subcommand; -- keeps it an IPC method name.
  return command(
    context,
    ["ipc", "-p", context.shellDirectory, "call", "--", "menu", method],
    allowFailure,
  );
}
