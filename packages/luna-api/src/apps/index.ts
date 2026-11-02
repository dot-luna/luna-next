import { rm } from "node:fs/promises";
import { join } from "pathe";
import { z } from "zod";
import { ApiError, respond } from "../lib/response.ts";
import { locked, parse, readOptional, writeFile } from "../lib/files.ts";
import { validate } from "../lib/validation.ts";
import { InstallContext } from "../self/install/command.ts";
import { installPackages } from "../self/install/packages.ts";
import { readCatalog, selectApps, type CatalogApp } from "./catalog.ts";
import { appContext, type AppOptions } from "./context.ts";
import { configureApp } from "./configure.ts";
import { installGitApp } from "./git.ts";
import { closeApp } from "./processes.ts";
import { attempt, quote, type AppInstallResult, type InstallFailure } from "../install/report.ts";
import { runHooks } from "./hooks.ts";

const stateSchema = z.strictObject({
  name: z.string(),
  source: z.string(),
  revision: z.string().optional(),
});

async function installOne(
  context: InstallContext,
  app: CatalogApp,
  force = false,
  closeApps = true,
) {
  if (process.getuid?.() === 0)
    throw new ApiError("INVALID_ENVIRONMENT", "Install apps as a normal user");
  const stateFile = join(context.env.LUNA_STATE_HOME_DIR!, "apps", `${app.id}.jsonc`);
  return locked({ configFile: stateFile, env: context.env }, async () => {
    if (closeApps) await closeApp(context, app);
    const original = await readOptional(stateFile);
    const saved = original
      ? validate(stateSchema, parse(original, stateFile), stateFile)
      : undefined;
    const previous =
      saved?.name === app.manifest.name && saved.source === app.manifest.source ? saved : undefined;
    const local = new InstallContext(
      context.repository,
      context.home,
      { ...context.env },
      context.onProgress,
      context.log,
    );
    local.progress(`Installing ${app.id}...`);
    await installPackages(local, app.manifest.deps ?? []);
    let revision: string | undefined;
    if (app.manifest.source === "git")
      revision = (await installGitApp(local, app, previous?.revision, force)).revision;
    else {
      let installed = false;
      let installedMiseVersion: string | undefined;
      if (["pacman", "aur"].includes(app.manifest.source)) {
        const result = await local.execute(["pacman", "-Qq", "--", app.manifest.name], true);
        if (![0, 1].includes(result.exitCode)) throw new ApiError("COMMAND_FAILED", result.stderr);
        installed = result.exitCode === 0;
      } else if (app.manifest.source === "mise") {
        const request = app.manifest.version
          ? `${app.manifest.name}@${app.manifest.version}`
          : app.manifest.name;
        // Mise resolves aliases and partial versions against its installed tools.
        const result = await local.execute([
          "mise",
          "--cd",
          local.home,
          "latest",
          "--installed",
          request,
        ]);
        installedMiseVersion = result.stdout.trim() || undefined;
        installed = Boolean(installedMiseVersion);
      } else installed = Boolean(previous);
      if (!installed || force) {
        await runHooks(local, app, "before_install");
        if (app.manifest.source === "local") {
          await runHooks(local, app, "before_build");
          await runHooks(local, app, "build");
          await runHooks(local, app, "after_build");
        } else
          await installPackages(local, [
            {
              name: app.manifest.name,
              source: app.manifest.source as "pacman" | "aur" | "mise",
              ...(app.manifest.version ? { version: app.manifest.version } : {}),
            },
          ]);
        await runHooks(local, app, "after_install");
      } else if (app.manifest.source === "mise") {
        await installPackages(local, [
          { name: app.manifest.name, source: "mise", version: installedMiseVersion! },
        ]);
      }
    }
    await writeFile(
      stateFile,
      JSON.stringify({
        name: app.manifest.name,
        source: app.manifest.source,
        ...(revision ? { revision } : {}),
      }) + "\n",
      original,
    );
    await configureApp(local, app);
    if (app.manifest.source === "git") {
      const workspace = join(local.env.LUNA_GIT_APP_BUILD_DIR!, app.manifest.name);
      const marker = await readOptional(join(workspace, ".luna-build.json"));
      if (marker && JSON.parse(marker).revision === revision)
        await rm(workspace, { recursive: true });
    }
    return app.id;
  });
}

/** Preserve catalog order even when the caller supplies names in another order. */
export async function installApps(
  context: InstallContext,
  names: string[] = [],
  force = false,
  skipFailed = false,
  closeApps = true,
): Promise<AppInstallResult> {
  const catalog = await readCatalog(context);
  let selected = selectApps(catalog, names);
  if (
    selected.some(
      (app) =>
        app.manifest.source === "aur" || app.manifest.deps?.some((dep) => dep.source === "aur"),
    ) &&
    !Bun.which("yay", { PATH: context.env.PATH })
  ) {
    const provider = catalog.find((app) => app.manifest.name === "yay");
    if (!provider) throw new ApiError("INVALID_ENVIRONMENT", "AUR installation requires yay");
    const ids = new Set([...selected.map((app) => app.id), provider.id]);
    selected = catalog.filter((app) => ids.has(app.id));
    if (
      selected
        .slice(0, selected.indexOf(provider) + 1)
        .some(
          (app) =>
            app.manifest.source === "aur" || app.manifest.deps?.some((dep) => dep.source === "aur"),
        )
    )
      throw new ApiError(
        "INVALID_METADATA",
        "The yay provider must precede AUR apps and dependencies in apps/apps.jsonc",
      );
  }
  const needsPrivileges = selected.some(
    (app) =>
      ["pacman", "aur", "git"].includes(app.manifest.source) ||
      app.manifest.deps?.some((item) => item.source !== "mise"),
  );
  let stopSudo = async () => {};
  if (needsPrivileges) {
    await context.execute(["sudo", "-v"]);
    stopSudo = context.keepSudoAlive();
  }
  try {
    const installed: string[] = [];
    const failed: InstallFailure[] = [];
    for (const app of selected) {
      const retry = `${quote(join(context.home, ".local/bin/luna"))} install ${quote(app.id)} --install-dir ${quote(context.repository)}${force ? " --force" : ""}${closeApps ? "" : " --no-close-apps"}`;
      if (
        await attempt(context, app.id, retry, skipFailed, failed, async () => {
          await installOne(context, app, force, closeApps);
        })
      )
        installed.push(app.id);
    }
    const result = {
      installed,
      failed,
      completed: failed.length === 0,
      logDirectory: context.log.directory,
    };
    context.log.finish(result);
    return result;
  } finally {
    await stopSudo();
  }
}

export const apps = {
  install(names: string[] = [], options: AppOptions = {}) {
    return respond(async () => {
      const context = await appContext(options);
      try {
        return await installApps(
          context,
          names,
          options.force,
          options.skipFailed,
          options.closeApps !== false,
        );
      } catch (error) {
        throw context.failure(error);
      }
    });
  },
  configure(names: string[] = [], options: AppOptions = {}) {
    return respond(async () => {
      const context = await appContext(options);
      try {
        const selected = selectApps(await readCatalog(context), names);
        for (const app of selected) {
          const file = join(context.env.LUNA_STATE_HOME_DIR!, "apps", `${app.id}.jsonc`);
          await locked({ configFile: file, env: context.env }, async () => {
            if (options.closeApps !== false) await closeApp(context, app);
            await configureApp(context, app);
          });
        }
        const configured = selected.map((app) => app.id);
        context.log.finish({ completed: true, configured, logDirectory: context.log.directory });
        return configured;
      } catch (error) {
        throw context.failure(error);
      }
    });
  },
};
