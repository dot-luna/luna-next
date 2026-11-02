import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "pathe";
import { repositoryPath, type RepositoryOptions } from "../lib/repository.ts";
import { ApiError } from "../lib/response.ts";
import { canonicalPath, overlaps } from "../lib/paths.ts";
import type { InstallLog } from "../install/log.ts";
import { InstallContext } from "../self/install/command.ts";

export interface AppOptions extends RepositoryOptions {
  onProgress?: (message: string) => void;
  force?: boolean;
  skipFailed?: boolean;
  closeApps?: boolean;
}

export async function appContext(options: AppOptions = {}, log?: InstallLog) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? Bun.env))
    if (value !== undefined) env[key] = value;
  if (!env.HOME || !isAbsolute(env.HOME) || resolve(env.HOME) === "/")
    throw new ApiError("INVALID_PATH", "HOME must be an absolute user home");
  const repository = await realpath(repositoryPath(options));
  // Paths also appear in generated native includes.
  // oxlint-disable-next-line no-control-regex
  if (repository === "/" || /[\x00-\x1f\x7f]/u.test(repository))
    throw new ApiError("INVALID_PATH", "Invalid checkout path");
  const home = await realpath(env.HOME);
  if (home === "/") throw new ApiError("INVALID_PATH", "HOME must not resolve to root");
  env.HOME = home;
  const define = (key: string, fallback: string) => (env[key] ||= fallback);
  define("XDG_CONFIG_HOME", join(home, ".config"));
  define("XDG_DATA_HOME", join(home, ".local/share"));
  define("XDG_CACHE_HOME", join(home, ".cache"));
  define("XDG_STATE_HOME", join(home, ".local/state"));
  define("LUNA_CONFIG_HOME_DIR", join(env.XDG_CONFIG_HOME!, "luna"));
  define("LUNA_DATA_HOME_DIR", join(env.XDG_DATA_HOME!, "luna"));
  define("LUNA_CACHE_HOME_DIR", join(env.XDG_CACHE_HOME!, "luna"));
  define("LUNA_STATE_HOME_DIR", join(env.XDG_STATE_HOME!, "luna"));
  define("LUNA_GIT_APP_CLONE_DIR", join(env.LUNA_DATA_HOME_DIR!, "git/clone"));
  define("LUNA_GIT_APP_BUILD_DIR", join(env.LUNA_CACHE_HOME_DIR!, "git/build"));
  define("LUNA_GIT_APP_INSTALL_DIR", join(env.LUNA_DATA_HOME_DIR!, "apps/git"));
  define("LUNA_LOCAL_APP_INSTALL_DIR", join(env.LUNA_DATA_HOME_DIR!, "apps/local"));
  for (const key of Object.keys(env).filter(
    (key) => /^LUNA_.*_DIR$/u.test(key) || /^XDG_(CONFIG|DATA|CACHE|STATE)_HOME$/u.test(key),
  )) {
    // oxlint-disable-next-line no-control-regex
    if (!isAbsolute(env[key]!) || resolve(env[key]!) === "/" || /[\x00-\x1f\x7f]/u.test(env[key]!))
      throw new ApiError("INVALID_PATH", `${key} must be an absolute non-root path`);
    env[key] = resolve(env[key]!);
  }
  const roots = await Promise.all(
    [
      "LUNA_GIT_APP_CLONE_DIR",
      "LUNA_GIT_APP_BUILD_DIR",
      "LUNA_GIT_APP_INSTALL_DIR",
      "LUNA_LOCAL_APP_INSTALL_DIR",
      "LUNA_CONFIG_HOME_DIR",
      "LUNA_STATE_HOME_DIR",
    ].map((key) => canonicalPath(env[key]!)),
  );
  for (const [index, root] of roots.entries()) {
    if (overlaps(root, repository) || roots.slice(index + 1).some((other) => overlaps(root, other)))
      throw new ApiError(
        "INVALID_PATH",
        "App clone, build, install, configuration and state roots must be separate from each other and the checkout",
      );
  }
  env.LUNA_ROOT = repository;
  env.LUNA_HOME_DIR = repository;
  const shims = join(env.MISE_DATA_DIR || join(env.XDG_DATA_HOME!, "mise"), "shims");
  env.PATH = `${join(home, ".local/bin")}:${shims}:${env.PATH ?? ""}`;
  env.LC_ALL = "C";
  return new InstallContext(repository, home, env, options.onProgress ?? (() => {}), log);
}
