import { $ } from "bun";
import { dirname, join, resolve } from "pathe";
import { childPath, entry, makeDirectory, remove, safePath, within, writeFile } from "../files.ts";
import { checked, command } from "../process.ts";
import { ApiError } from "../response.ts";
import { hooks } from "./hooks.ts";
import type { AppInfo, Context } from "./types.ts";
import { gitDirectory, installGit, validateGit } from "./git.ts";

export function packageDirectory(context: Context, app: AppInfo): string {
  return app.manifest.source === "git" ? gitDirectory(context, app) : join(context.data, "apps/local", app.id);
}

export async function installed(context: Context, app: AppInfo): Promise<boolean> {
  const { name, source } = app.manifest;
  if (source === "git" || source === "local") {
    const directory = packageDirectory(context, app);
    await safePath(dirname(directory));
    const stat = await entry(directory);
    if (!stat) return false;
    if (source === "local") {
      if (stat.kind !== "symlink" || resolve(dirname(directory), (await $`readlink -- ${directory}`.text()).trim()) !== localSource(context, app)) {
        throw new ApiError("CONFLICT", `Local app path is not Luna's declared link: ${directory}`);
      }
    } else {
      await validateGit(context, app);
    }
    const marker = installationMarker(context, app);
    await safePath(marker);
    if (!await entry(marker)) return false;
    if (await Bun.file(marker).text() !== installationIdentity(app)) throw new ApiError("CONFLICT", `Installation identity changed: ${marker}`);
    return true;
  }
  const argv = source === "mise"
    ? ["mise", "where", miseName(app)]
    : ["pacman", "-Q", "--", name];
  const result = await command(context, argv, app.directory, true);
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  throw new ApiError("COMMAND_FAILED", `Could not determine whether ${app.id} is installed`, { exitCode: result.exitCode });
}

export function localSource(context: Context, app: AppInfo): string {
  return resolve(context.repository, app.manifest.url!);
}

function installationMarker(context: Context, app: AppInfo): string {
  return join(context.data, "state/apps", app.id + ".installed");
}

function installationIdentity(app: AppInfo): string {
  return JSON.stringify({ source: app.manifest.source, url: app.manifest.url }) + "\n";
}

function miseName(app: AppInfo): string {
  return app.manifest.name + (app.manifest.version ? "@" + app.manifest.version : "");
}

export async function installPackage(context: Context, app: AppInfo, update: boolean): Promise<void> {
  const exists = await installed(context, app);
  if (exists && !update) return;
  if (!exists && update) throw new ApiError("NOT_INSTALLED", `Cannot update an uninstalled app: ${app.id}`);
  await hooks(context, app, "before_install");
  const { source, name } = app.manifest;
  switch (source) {
    case "pacman":
      await checked(context, ["sudo", "pacman", "-S", ...(update ? [] : ["--needed"]), "--noconfirm", "--", name]);
      break;
    case "aur":
      await checked(context, ["yay", "-S", "--aur", ...(update ? [] : ["--needed"]), "--noconfirm", "--", name]);
      break;
    case "mise":
      await checked(context, update && !app.manifest.version
        ? ["mise", "upgrade", "--yes", "--", name]
        : ["mise", "use", "--global", "--yes", "--", miseName(app)]);
      break;
    case "git":
      await installGit(context, app, Boolean(await entry(packageDirectory(context, app))));
      break;
    case "local": {
      const sourceDirectory = localSource(context, app);
      const destination = packageDirectory(context, app);
      if (within(sourceDirectory, destination) || within(destination, sourceDirectory)) throw new ApiError("INVALID_PATH", "Local source and destination overlap");
      await safePath(sourceDirectory);
      if (!(await Bun.file(sourceDirectory).stat()).isDirectory()) throw new ApiError("INVALID_PATH", `Local source must be a directory: ${sourceDirectory}`);
      await makeDirectory(dirname(destination));
      if (!await entry(destination)) await $`ln -s -- ${sourceDirectory} ${destination}`.quiet();
      await hooks(context, app, "before_build");
      await hooks(context, app, "build");
      await hooks(context, app, "after_build");
      break;
    }
  }
  await hooks(context, app, "after_install");
  if (source === "git" || source === "local") await writeFile(installationMarker(context, app), installationIdentity(app));
}

/** Remove the package only; configuration, Git sources, build workspaces, and user data remain. */
export async function uninstallPackage(context: Context, app: AppInfo): Promise<void> {
  if (!await installed(context, app)) return;
  await hooks(context, app, "before_uninstall");
  const { source, name } = app.manifest;
  if (source === "pacman" || source === "aur") {
    await checked(context, ["sudo", "pacman", "-R", "--noconfirm", "--", name]);
  } else if (source === "mise") {
    await checked(context, ["mise", "uninstall", "--yes", "--", miseName(app)]);
  } else if (source === "local") {
    await $`unlink -- ${packageDirectory(context, app)}`.quiet();
  } else {
    const directory = childPath(context.env.LUNA_GIT_APP_INSTALL_DIR!, app.id);
    await safePath(directory);
    await remove(directory);
  }
  if (source === "git" || source === "local") await Bun.file(installationMarker(context, app)).delete();
  await hooks(context, app, "after_uninstall");
}
