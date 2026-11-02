import { dirname, join } from "pathe";
import { entry, makeDirectory, safePath } from "../files.ts";
import { checked } from "../process.ts";
import { ApiError } from "../response.ts";
import { hooks } from "./hooks.ts";
import type { AppInfo, Context } from "./types.ts";

export function gitDirectory(context: Context, app: AppInfo): string {
  return join(context.env.LUNA_GIT_APP_CLONE_DIR!, app.id);
}

export async function validateGit(context: Context, app: AppInfo): Promise<void> {
  const directory = gitDirectory(context, app);
  await safePath(directory);
  if ((await entry(join(directory, ".git")))?.kind !== "directory") throw new ApiError("CONFLICT", `Git app must be a standalone clone: ${directory}`);
  const root = await checked(context, ["git", "-C", directory, "rev-parse", "--show-toplevel"], app.directory, true);
  const origin = await checked(context, ["git", "-C", directory, "remote", "get-url", "origin"], app.directory, true);
  if (root !== directory || origin !== app.manifest.url) throw new ApiError("CONFLICT", `Git app path has a different repository or origin: ${directory}`);
}

async function selectedRef(context: Context, app: AppInfo): Promise<string | undefined> {
  const { version, url, git_release_tag_pattern: pattern, git_include_prereleases: prereleases } = app.manifest;
  if (version !== "latest") {
    if (version) await checked(context, ["git", "check-ref-format", "--allow-onelevel", version], app.directory, true);
    return version;
  }
  const output = await checked(context, ["git", "-c", "versionsort.suffix=-", "ls-remote", "--tags", "--refs", "--sort=-version:refname", "--", url!, ...(pattern ? [pattern] : [])], app.directory, true);
  const tags = output.split("\n").filter(Boolean).map(line => line.split(/\s+/u)[1]?.replace(/^refs\/tags\//u, "")).filter((tag): tag is string => Boolean(tag));
  const tag = tags.find(tag => prereleases || !/^v?\d+\.\d+\.\d+-/u.test(tag));
  if (!tag && (pattern || tags.length)) throw new ApiError("NO_RELEASE", `No eligible Git release for ${app.id}`);
  return tag;
}

/** Keep checkouts separate from disposable builds; reject dirty or unrelated repositories. */
export async function installGit(context: Context, app: AppInfo, exists: boolean): Promise<void> {
  const directory = gitDirectory(context, app);
  await safePath(directory);
  const git = (...args: string[]) => checked(context, ["git", "-C", directory, ...args], app.directory, true);
  if (exists) {
    await validateGit(context, app);
    if (await git("status", "--porcelain", "--untracked-files=all")) throw new ApiError("CONFLICT", `Git checkout has local changes: ${directory}`);
    // A branch or retained tag must own HEAD before a fetch can replace references.
    if (!await git("for-each-ref", "--contains", "HEAD", "--format=%(refname)", "refs/heads", "refs/tags", "refs/remotes", "refs/luna")) {
      throw new ApiError("CONFLICT", `Git checkout has an unreferenced detached commit: ${directory}`);
    }
  }
  const ref = await selectedRef(context, app);
  if (!exists) {
    await makeDirectory(dirname(directory));
    await checked(context, ["git", "clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), "--", app.manifest.url!, directory], app.directory);
  } else if (ref) {
    await git("fetch", "--depth", "1", "origin", ref);
    await git("checkout", "--detach", "FETCH_HEAD");
    // Retain fetched revisions outside FETCH_HEAD so a later update can prove ownership.
    await git("update-ref", "refs/luna/selected", "HEAD");
  } else {
    // Querying the current branch fails on a detached checkout instead of discarding it.
    await git("symbolic-ref", "--quiet", "HEAD");
    await git("pull", "--ff-only");
  }
  const concrete = ref ?? await git("rev-parse", "--abbrev-ref", "HEAD");
  const env = { ...context.env, LUNA_PACKAGE_VERSION: concrete };
  await hooks(context, app, "before_build", env);
  await hooks(context, app, "build", env);
  await hooks(context, app, "after_build", env);
}
