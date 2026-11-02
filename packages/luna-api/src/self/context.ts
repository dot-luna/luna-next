import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "pathe";
import { repositoryPath } from "../lib/repository.ts";
import { ApiError } from "../lib/response.ts";
import { validateCheckout, validateRef } from "./install/checkout.ts";
import { InstallContext } from "./install/command.ts";
import type { UpdateOptions } from "./update.ts";

// Paths are passed to filesystem operations and subprocesses; reject terminal controls.
// oxlint-disable-next-line no-control-regex
const controlCharacters = /[\x00-\x1f\x7f]/u;

/** Resolve and validate once for install/update without changing the process environment. */
export async function prepareContext(options: UpdateOptions) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? Bun.env)) {
    if (value !== undefined) env[key] = value;
  }
  const selectedHome = env.HOME;
  if (
    !selectedHome ||
    !isAbsolute(selectedHome) ||
    resolve(selectedHome) === "/" ||
    controlCharacters.test(selectedHome)
  ) {
    throw new ApiError("INVALID_PATH", "HOME must be an absolute non-root user home directory");
  }
  const home = await realpath(selectedHome);
  if (home === "/")
    throw new ApiError("INVALID_PATH", "HOME must not resolve to the filesystem root");
  env.HOME = home;
  if (process.platform !== "linux" || process.getuid?.() === 0) {
    throw new ApiError("INVALID_ENVIRONMENT", "Run as a normal Arch Linux user, without sudo");
  }
  for (const tool of ["git", "pacman", "sudo", "bash"]) {
    if (!Bun.which(tool, { PATH: env.PATH }))
      throw new ApiError("INVALID_ENVIRONMENT", `${tool} is required`);
  }
  const selected = repositoryPath(options);
  if (controlCharacters.test(selected)) throw new ApiError("INVALID_PATH", "Invalid checkout path");
  const repository = await realpath(selected);
  if (repository === "/") throw new ApiError("INVALID_PATH", "Invalid checkout path");
  env.LUNA_ROOT = repository;
  const context = new InstallContext(repository, home, env, options.onProgress ?? (() => {}));
  context.progress("Checking installation prerequisites...");
  await validateCheckout(context);
  await validateRef(context, options.ref ?? "latest");
  return context;
}
