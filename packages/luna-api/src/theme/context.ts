import { dirname, isAbsolute, join, resolve } from "pathe";
import { ApiError } from "../lib/response.ts";
import type { InstallLog } from "../install/log.ts";
import { InstallContext } from "../self/install/command.ts";
import type { ThemeOptions } from "./types.ts";

export function themeContext(options: ThemeOptions = {}, log?: InstallLog) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? Bun.env))
    if (value !== undefined) env[key] = value;
  const base = (name: string, fallback: string) => {
    const value = env[name] || (env.HOME ? join(env.HOME, fallback) : undefined);
    if (!value || !isAbsolute(value))
      throw new ApiError("INVALID_PATH", `Set an absolute ${name} or HOME`);
    return value;
  };
  const path = (value: string) => {
    // oxlint-disable-next-line no-control-regex
    if (!value || /[\x00-\x1f\x7f]/u.test(value) || resolve(value) === "/")
      throw new ApiError(
        "INVALID_PATH",
        "Theme paths must be nonempty and cannot be the filesystem root",
      );
    return resolve(value);
  };
  const configFile = path(
    options.configFile ??
      join(
        env.LUNA_CONFIG_HOME_DIR || join(base("XDG_CONFIG_HOME", ".config"), "luna"),
        "theme.jsonc",
      ),
  );
  const libraryDir = path(
    options.libraryDir ??
      join(env.LUNA_DATA_HOME_DIR || join(base("XDG_DATA_HOME", ".local/share"), "luna"), "themes"),
  );
  return {
    log,
    env,
    configFile,
    libraryDir,
    wallpaperDir: path(options.wallpaperDir ?? join(dirname(libraryDir), "wallpapers")),
  };
}

export type ThemeContext = ReturnType<typeof themeContext>;

/** Capture desktop tool output; API calls never print or read terminal input. */
export async function command(context: Pick<ThemeContext, "env" | "log">, args: string[]) {
  if (context.log) {
    const c = new InstallContext(
      context.env.LUNA_ROOT || process.cwd(),
      context.env.HOME || "",
      context.env,
      () => {},
      context.log,
    );
    return (await c.execute(args)).stdout.trim();
  }
  const child = Bun.spawn(args, {
    env: context.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status !== 0)
    throw new ApiError(
      "COMMAND_FAILED",
      `${args[0]} failed (${status}): ${(stderr || stdout).trim()}`,
    );
  return stdout.trim();
}
