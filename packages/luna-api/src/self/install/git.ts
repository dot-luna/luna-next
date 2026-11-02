import { ApiError } from "../../lib/response.ts";
import type { InstallContext } from "./command.ts";
import type { GitIdentity, InstallOptions } from "./types.ts";

function valid(value: string | undefined): value is string {
  // Identity is displayed by Git and app hooks; reject embedded terminal controls.
  // oxlint-disable-next-line no-control-regex
  return Boolean(value?.trim() && !/[\x00-\x1f\x7f]/u.test(value));
}

async function readSetting(context: InstallContext, key: string) {
  const value = await context.execute(["git", "config", "--global", "--get", key], true);
  if (value.exitCode !== 0 && value.exitCode !== 1)
    throw new ApiError("COMMAND_FAILED", value.stderr.trim());
  return value.exitCode === 0 ? value.stdout.trim() : undefined;
}

export async function configureGit(context: InstallContext, options: InstallOptions) {
  const current: Partial<GitIdentity> = {
    name: options.git?.name ?? (await readSetting(context, "user.name")),
    email: options.git?.email ?? (await readSetting(context, "user.email")),
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
  // Write keys through Git; unrelated global settings and include directives remain intact.
  for (const [key, value] of [
    ["user.name", identity.name],
    ["user.email", identity.email],
  ]) {
    await context.execute(["git", "config", "--global", key!, value!]);
  }
  await context.execute(["bash", "apps/git/scripts/after-install.sh"]);
}
