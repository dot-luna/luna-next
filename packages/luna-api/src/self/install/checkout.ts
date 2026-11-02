import { lstat, realpath } from "node:fs/promises";
import { join } from "pathe";
import { ApiError } from "../../lib/response.ts";
import type { InstallContext } from "./command.ts";

const origins = [
  "https://github.com/dot-luna/luna-next.git",
  "https://github.com/dot-luna/luna-next",
  "git@github.com:dot-luna/luna-next.git",
];

/** Validate checkout ownership even when bootstrap skips its update. */
export async function validateCheckout(context: InstallContext) {
  const directory = await lstat(join(context.repository, ".git"));
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new ApiError("INVALID_PATH", "Expected a standalone Luna checkout");
  }
  const root = (await context.git(["rev-parse", "--show-toplevel"])).stdout.trim();
  if ((await realpath(root)) !== context.repository) {
    throw new ApiError("INVALID_PATH", "The installation path must be the Git repository root");
  }
  const origin = (await context.git(["remote", "get-url", "origin"])).stdout.trim();
  if (!origins.includes(origin))
    throw new ApiError("INVALID_PATH", "The checkout has a different origin");
}

export async function validateRef(context: InstallContext, ref: string) {
  if (!ref || ref.startsWith("-"))
    throw new ApiError("INVALID_ARGUMENT", "Invalid branch or tag name");
  const result = await context.git(["check-ref-format", `refs/heads/${ref}`], true);
  if (result.exitCode !== 0) throw new ApiError("INVALID_ARGUMENT", "Invalid branch or tag name");
}

/** Fetch the selected branch/tag without resetting edits, rebasing, or replacing local tags. */
export async function updateCheckout(context: InstallContext, requestedRef: string) {
  const changes = await context.git(["status", "--porcelain", "--untracked-files=normal"]);
  if (changes.stdout.trim())
    throw new ApiError("INVALID_PATH", "Commit or move local changes before installing");
  let ref = requestedRef;
  if (ref === "latest") {
    const remote = await context.git(["ls-remote", "--symref", "origin", "HEAD"]);
    const target = remote.stdout.match(/^ref: refs\/heads\/(.+)\s+HEAD$/mu)?.[1];
    if (!target) throw new ApiError("INVALID_PATH", "Cannot resolve the remote default branch");
    ref = target.trim();
  }
  await validateRef(context, ref);
  const branch = `refs/heads/${ref}`;
  const tag = `refs/tags/${ref}`;
  const refs = (await context.git(["ls-remote", "--refs", "origin", branch, tag])).stdout
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/u)[1]);
  const isBranch = refs.includes(branch);
  if (!isBranch && !refs.includes(tag))
    throw new ApiError("INVALID_PATH", `No remote branch or tag named ${ref}`);

  const symbolic = await context.git(["symbolic-ref", "--quiet", "HEAD"], true);
  if (![0, 1].includes(symbolic.exitCode))
    throw new ApiError("COMMAND_FAILED", symbolic.stderr.trim());
  const detached = symbolic.exitCode === 1;
  const head = detached
    ? (await context.git(["rev-parse", "--verify", "HEAD^{commit}"])).stdout.trim()
    : undefined;
  const selected = isBranch ? `refs/remotes/origin/${ref}` : "FETCH_HEAD";
  await context.git(["fetch", "--no-tags", "origin", isBranch ? `+${branch}:${selected}` : tag]);
  if (head) {
    // A fetch can move the only remote ref retaining a detached personal commit.
    const retained = await context.git([
      "for-each-ref",
      "--contains",
      head,
      "--format=%(refname)",
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ]);
    if (
      !retained.stdout.trim() &&
      head !== (await context.git(["rev-parse", "--verify", `${selected}^{commit}`])).stdout.trim()
    ) {
      throw new ApiError(
        "INVALID_PATH",
        "Save the unreferenced detached commit on a branch before installing",
      );
    }
  }
  if (isBranch) {
    const local = await context.git(["show-ref", "--verify", "--quiet", branch], true);
    if (![0, 1].includes(local.exitCode)) throw new ApiError("COMMAND_FAILED", local.stderr.trim());
    await context.git(
      local.exitCode === 0
        ? ["switch", "--no-overwrite-ignore", "--no-guess", ref]
        : ["switch", "--no-overwrite-ignore", "--no-track", "-c", ref, selected],
    );
    await context.git([
      "pull",
      "--ff-only",
      "--no-rebase",
      "--no-autostash",
      "--no-tags",
      "origin",
      branch,
    ]);
  } else {
    await context.git(["switch", "--no-overwrite-ignore", "--detach", selected]);
  }
}
