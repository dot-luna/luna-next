import { hasControlCharacters } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";
import type { GitIdentity, InstallOptions } from "@/modules/self/context.ts";
import type { InstallContext } from "./command.ts";

class GitConfigurator {
  /**
   * Ensure a global Git identity, asking requestGitIdentity only when a value is missing,
   * then run the Git app's after-install script. Throws INPUT_REQUIRED without a valid identity.
   */
  async configure({ context, options }: { context: InstallContext; options: InstallOptions }) {
    const configured = {
      name: await this._read({ context, key: "user.name" }),
      email: await this._read({ context, key: "user.email" }),
    };
    const current: Partial<GitIdentity> = {
      name: options.git?.name ?? configured.name,
      email: options.git?.email ?? configured.email,
    };
    const identity =
      this._valid(current.name) && this._valid(current.email)
        ? (current as GitIdentity)
        : await options.requestGitIdentity?.(current);
    if (!identity || !this._valid(identity.name) || !this._valid(identity.email)) {
      throw new ApiError(
        "INPUT_REQUIRED",
        "Provide a nonempty Git name and email using --git-name and --git-email, or run interactively",
      );
    }
    // Keep included identities at their source unless the caller explicitly overrides a value.
    if (options.git?.name !== undefined || !this._valid(configured.name)) {
      await context.execute(["git", "config", "--global", "user.name", identity.name]);
    }
    if (options.git?.email !== undefined || !this._valid(configured.email)) {
      await context.execute(["git", "config", "--global", "user.email", identity.email]);
    }
    await context.execute(["bash", "apps/git/scripts/after-install.sh"]);
  }

  /** Identity is displayed by Git and app hooks; reject embedded terminal controls. */
  private _valid(value: string | undefined): value is string {
    return Boolean(value?.trim() && !hasControlCharacters(value));
  }

  /** Read a global value, following includes; undefined when it is unset. */
  private async _read({ context, key }: { context: InstallContext; key: string }) {
    const value = await context.execute(
      ["git", "config", "--global", "--includes", "--get", key],
      true,
    );
    if (value.exitCode !== 0 && value.exitCode !== 1)
      throw new ApiError("COMMAND_FAILED", value.stderr.trim());
    return value.exitCode === 0 ? value.stdout.trim() : undefined;
  }
}

export const gitConfigurator = new GitConfigurator();
