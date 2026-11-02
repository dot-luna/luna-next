
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join } from "pathe";
import { ApiError } from "../lib/response.ts";
import { metadata, readOptional, writeFile } from "../lib/files.ts";
import { replaceExport } from "../lib/tree.ts";
import type { InstallContext } from "../self/install/command.ts";
import type { CatalogApp } from "./catalog.ts";
import { runHooks } from "./hooks.ts";

async function selectRef(context: InstallContext, app: CatalogApp): Promise<string | null> {
  const m = app.manifest;
  if (m.version && m.version !== "latest") {
    const result = await context.execute(
      ["git", "check-ref-format", `refs/heads/${m.version}`],
      true,
    );
    if (result.exitCode !== 0 || m.version.startsWith("-"))
      throw new ApiError("INVALID_ARGUMENT", `Invalid Git ref for ${app.id}`);
    return m.version;
  }
  if (m.version === "latest") {
    const refs = (await context.execute(["git", "ls-remote", "--refs", "--tags", m.url!])).stdout;
    const pattern = m.git_release_tag_pattern ? new Bun.Glob(m.git_release_tag_pattern) : undefined;
    const versions = refs
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/u)[1]?.replace(/^refs\/tags\//u, ""))
      .filter((name): name is string => Boolean(name));
    const selected = versions
      .filter(
        (name) =>
          (!pattern || pattern.match(name)) &&
          /^v?\d+\.\d+\.\d+(?:[-+].*)?$/u.test(name) &&
          Bun.semver.satisfies(name.replace(/^v/u, ""), ">=0.0.0-0") &&
          (m.git_include_prereleases || !name.split("+")[0]!.includes("-")),
      )
      .sort((a, b) => Bun.semver.order(b.replace(/^v/u, ""), a.replace(/^v/u, "")))[0];
    if (selected) return selected;
  }
  const head = (await context.execute(["git", "ls-remote", "--symref", m.url!, "HEAD"])).stdout;
  const ref = head.match(/^ref: refs\/heads\/(.+)\s+HEAD$/mu)?.[1]?.trim();
  return ref ?? null;
}

/** Managed clones stay detached; default build workspaces are disposable copies. */
export async function installGitApp(
  context: InstallContext,
  app: CatalogApp,
  previousRevision?: string,
  force = false,
) {
  const clone = join(context.env.LUNA_GIT_APP_CLONE_DIR!, app.manifest.name);
  const ref = await selectRef(context, app);
  context.env.LUNA_PACKAGE_VERSION = ref ?? "latest";
  await mkdir(dirname(clone), { recursive: true });
  const existing = await metadata(clone);
  if (!existing) await runHooks(context, app, "before_install");
  if (
    existing &&
    (!existing.isDirectory() || !(await metadata(join(clone, ".git")))?.isDirectory())
  )
    throw new ApiError("INVALID_PATH", `Expected a managed Git clone: ${clone}`);
  if (!existing) {
    const stage = await mkdtemp(join(dirname(clone), ".luna-clone-"));
    try {
      const staged = join(stage, "clone");
      await context.execute(["git", "clone", "--", app.manifest.url!, staged]);
      await rename(staged, clone);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  const git = (args: string[], allow = false) =>
    context.execute(["git", "-C", clone, ...args], allow);
  if ((await git(["remote", "get-url", "origin"])).stdout.trim() !== app.manifest.url)
    throw new ApiError("INVALID_PATH", `Git app origin differs: ${app.id}`);
  if ((await git(["status", "--porcelain", "--untracked-files=normal"])).stdout.trim())
    throw new ApiError("CONFLICT", `Git app has local changes: ${clone}`);
  const old = (await git(["rev-parse", "HEAD"])).stdout.trim();
  const symbolic = await git(["symbolic-ref", "--quiet", "HEAD"], true);
  let revision: string;
  if (ref) {
    const refs = (
      await git(["ls-remote", "--refs", "origin", `refs/heads/${ref}`, `refs/tags/${ref}`])
    ).stdout;
    const branch = refs.split("\n").some((line) => line.endsWith(`\trefs/heads/${ref}`));
    if (!branch && !refs.split("\n").some((line) => line.endsWith(`\trefs/tags/${ref}`)))
      throw new ApiError("INVALID_ARGUMENT", `Missing Git ref ${ref} for ${app.id}`);
    await git(["fetch", "--no-tags", "origin", `${branch ? "refs/heads" : "refs/tags"}/${ref}`]);
    revision = (await git(["rev-parse", "FETCH_HEAD^{commit}"])).stdout.trim();
    if (symbolic.exitCode === 1 && old !== revision && old !== previousRevision) {
      const retained = (
        await git([
          "for-each-ref",
          "--contains",
          old,
          "--format=%(refname)",
          "refs/heads",
          "refs/remotes",
          "refs/tags",
        ])
      ).stdout;
      if (!retained.trim())
        throw new ApiError(
          "CONFLICT",
          `Save the detached personal commit in ${clone} before installing`,
        );
    } else if (![0, 1].includes(symbolic.exitCode))
      throw new ApiError("COMMAND_FAILED", symbolic.stderr);
    if (revision === previousRevision && old === revision && !force)
      return { revision, changed: false };
    await git(["switch", "--no-overwrite-ignore", "--detach", "FETCH_HEAD"]);
  } else {
    revision = old;
    context.env.LUNA_PACKAGE_VERSION = revision;
    if (![0, 1].includes(symbolic.exitCode))
      throw new ApiError("COMMAND_FAILED", symbolic.stderr);
    if (revision === previousRevision && old === revision && !force)
      return { revision, changed: false };
  }
  const build = join(context.env.LUNA_GIT_APP_BUILD_DIR!, app.manifest.name);
  await mkdir(dirname(build), { recursive: true });
  if (app.manifest.hooks?.before_build?.length) await runHooks(context, app, "before_build");
  else if (app.manifest.hooks?.build?.length) {
    const marker = join(build, ".luna-build.json");
    if (await metadata(build)) {
      const text = await readOptional(marker);
      if (!text || JSON.parse(text).app !== app.id)
        throw new ApiError(
          "INVALID_PATH",
          `Refusing to replace an unmanaged build workspace: ${build}`,
        );
    }
    await replaceExport(context, clone, build, clone, [".git"]);
    await writeFile(
      marker,
      JSON.stringify({ app: app.id, revision }) + "\n",
      await readOptional(marker),
    );
  }
  await runHooks(context, app, "build");
  await runHooks(context, app, "after_build");
  await runHooks(context, app, "after_install");
  return { revision, changed: true };
}
