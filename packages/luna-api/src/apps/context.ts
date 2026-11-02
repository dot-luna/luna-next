import { $ } from "bun";
import { isAbsolute, join, resolve } from "pathe";
import { createLogger } from "luna-logger";
import { safePath, within } from "../files.ts";
import { runCommand } from "../process.ts";
import { ApiError } from "../response.ts";
import type { AppsOptions, Context } from "./types.ts";

function absolute(path: string | undefined, label: string): string {
  if (!path || !isAbsolute(path) || resolve(path) === "/" || /[\x00-\x1f\x7f]/u.test(path) || path.split("/").includes("..")) {
    throw new ApiError("INVALID_PATH", `${label} must be an absolute non-root path without '..' or control characters`);
  }
  return resolve(path);
}

export async function createContext(options: AppsOptions): Promise<Context> {
  const env = options.env ?? Object.fromEntries(Object.entries(Bun.env).filter((item): item is [string, string] => item[1] !== undefined));
  const home = absolute(env.HOME, "HOME");
  const config = absolute(env.LUNA_CONFIG_HOME_DIR || join(env.XDG_CONFIG_HOME || join(home, ".config"), "luna"), "LUNA_CONFIG_HOME_DIR");
  const data = absolute(env.LUNA_DATA_HOME_DIR || join(env.XDG_DATA_HOME || join(home, ".local/share"), "luna"), "LUNA_DATA_HOME_DIR");
  const cache = absolute(env.LUNA_CACHE_HOME_DIR || join(env.XDG_CACHE_HOME || join(home, ".cache"), "luna"), "LUNA_CACHE_HOME_DIR");
  const selected = options.repository || env.LUNA_NEXT_ROOT || join(home, ".local/src/luna-next");
  const repository = (await $`realpath -e -- ${selected}`.text()).trim();
  for (const path of [config, data, cache]) {
    if (within(path, repository) || within(repository, path) || path === home || within(path, home)) {
      throw new ApiError("INVALID_PATH", `Managed directory overlaps HOME or the repository: ${path}`);
    }
    await safePath(path);
  }
  for (const [index, path] of [config, data, cache].entries()) {
    for (const other of [config, data, cache].slice(index + 1)) {
      if (within(path, other) || within(other, path)) throw new ApiError("INVALID_PATH", `Managed directories overlap: ${path}, ${other}`);
    }
  }
  const environment = {
    ...env,
    LUNA_NEXT_ROOT: repository,
    LUNA_CONFIG_HOME_DIR: config,
    LUNA_DATA_HOME_DIR: data,
    LUNA_CACHE_HOME_DIR: cache,
    LUNA_GIT_APP_CLONE_DIR: absolute(env.LUNA_GIT_APP_CLONE_DIR || join(data, "git/clone"), "LUNA_GIT_APP_CLONE_DIR"),
    LUNA_GIT_APP_BUILD_DIR: absolute(env.LUNA_GIT_APP_BUILD_DIR || join(cache, "git/build"), "LUNA_GIT_APP_BUILD_DIR"),
    LUNA_GIT_APP_INSTALL_DIR: absolute(env.LUNA_GIT_APP_INSTALL_DIR || join(data, "apps/git"), "LUNA_GIT_APP_INSTALL_DIR"),
  };
  const gitPaths = [environment.LUNA_GIT_APP_CLONE_DIR, environment.LUNA_GIT_APP_BUILD_DIR, environment.LUNA_GIT_APP_INSTALL_DIR];
  const reserved = [config, join(data, "state"), join(data, "apps/local"), join(cache, "locks")];
  for (const [index, path] of gitPaths.entries()) {
    await safePath(path);
    if (within(path, repository) || within(repository, path) || within(path, home)) throw new ApiError("INVALID_PATH", `Git app directory overlaps HOME or the repository: ${path}`);
    if (reserved.some(other => within(path, other) || within(other, path))) {
      throw new ApiError("INVALID_PATH", `Git app directory overlaps managed configuration or reserved state: ${path}`);
    }
    for (const other of gitPaths.slice(index + 1)) {
      if (within(path, other) || within(other, path)) throw new ApiError("INVALID_PATH", `Git app directories overlap: ${path}, ${other}`);
    }
  }
  return { repository, env: environment, config, data, cache, logger: options.logger ?? createLogger({ name: "luna-api" }), run: options.run ?? runCommand };
}
