import { ApiError } from "../../lib/response.ts";
import type { InstallContext } from "./command.ts";
import type { GitIdentity, InstallOptions } from "./types.ts";

function valid(value: string | undefined): value is string {
  // Identity is displayed by Git and app hooks; reject embedded terminal controls.
  // oxlint-disable-next-line no-control-regex
  return Boolean(value?.trim() && !/[\x00-\x1f\x7f]/u.test(value));
}

async function readSetting(context: InstallContext, key: string) {
  const value = await context.execute(
    ["git", "config", "--global", "--includes", "--get", key],
    true,
  );
  if (value.exitCode !== 0 && value.exitCode !== 1)
    throw new ApiError("COMMAND_FAILED", value.stderr.trim());
  return value.exitCode === 0 ? value.stdout.trim() : undefined;
}

export async function configureGit(context: InstallContext, options: InstallOptions) {
  const configured = {
    name: await readSetting(context, "user.name"),
    email: await readSetting(context, "user.email"),
  };
  const current: Partial<GitIdentity> = {
    name: options.git?.name ?? configured.name,
    email: options.git?.email ?? configured.email,
  };
  const identity =
    valid(current.name) && valid(current.email)
      ? (current as GitIdentity)
      : await options.requestGitIdentity?.(current);
  if (!identity || !valid(identity.name) || !valid(identity.email)) {
    throw new ApiError(
      "INPUT_REQUIRED",
      "Provide a nonempty Git name and email using --git-name and --git-email, or run interactively",
    );
  }
  // Keep included identities at their source unless the caller explicitly overrides a value.
  if (options.git?.name !== undefined || !valid(configured.name)) {
    await context.execute(["git", "config", "--global", "user.name", identity.name]);
  }
  if (options.git?.email !== undefined || !valid(configured.email)) {
    await context.execute(["git", "config", "--global", "user.email", identity.email]);
  }
  await context.execute(["bash", "apps/git/scripts/after-install.sh"]);
}
