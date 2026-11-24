import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "pathe";
import { environment } from "@/lib/env.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { repositoryPath, type RepositoryOptions } from "@/lib/repository.ts";
import { ApiError } from "@/lib/response.ts";
import { selfCheckout } from "./install/checkout.ts";
import { InstallContext } from "./install/command.ts";

export interface UpdateOptions extends RepositoryOptions {
  /** Branch or tag; latest follows the remote default branch. */
  ref?: string;
  /** Human-readable progress; subprocess output is captured, never printed by the API. */
  onProgress?: (message: string) => void;
}

export interface GitIdentity {
  name: string;
  email: string;
}

export interface InstallOptions extends UpdateOptions {
  /** install.sh already updated the checkout and published the CLI. */
  fromBootstrap?: boolean;
  skipFailed?: boolean;
  closeApps?: boolean;
  /** Explicit values replace the corresponding global Git identity settings. */
  git?: Partial<GitIdentity>;
  /** Called at the Git stage only when identity values are missing. */
  requestGitIdentity?: (current: Partial<GitIdentity>) => Promise<GitIdentity>;
}

class SelfContextResolver {
  /**
   * Resolve HOME and the checkout, require a normal Arch Linux user with git, pacman, sudo
   * and bash, then validate the checkout and ref. Never changes the process environment.
   */
  async resolve(options: UpdateOptions) {
    const env = environment(options.env);
    const selectedHome = env.HOME;
    if (
      !selectedHome ||
      !isAbsolute(selectedHome) ||
      resolve(selectedHome) === "/" ||
      hasControlCharacters(selectedHome)
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
    if (hasControlCharacters(selected)) throw new ApiError("INVALID_PATH", "Invalid checkout path");
    const repository = await realpath(selected);
    if (repository === "/") throw new ApiError("INVALID_PATH", "Invalid checkout path");
    env.LUNA_ROOT = repository;
    const context = new InstallContext(repository, home, env, options.onProgress ?? (() => {}));
    context.progress("Checking installation prerequisites...");
    try {
      await selfCheckout.validate(context);
      await selfCheckout.validateRef({ context, ref: options.ref ?? "latest" });
    } catch (error) {
      throw context.failure(error);
    }
    return context;
  }
}

export const selfContext = new SelfContextResolver();
