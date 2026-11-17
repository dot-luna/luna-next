import { join } from "pathe";
import { ApiError } from "@/lib/response.ts";
import { locked, parse, readOptional, writeFile } from "@/lib/files.ts";
import { validate } from "@/lib/validation.ts";
import { InstallContext } from "@/self/install/command.ts";
import { installPackages } from "@/self/install/packages.ts";
import { attempt, quote, type AppInstallResult, type InstallFailure } from "@/install/report.ts";
import { appCatalog, type CatalogApp } from "./catalog.ts";
import { appConfigurator } from "./configure.ts";
import { appGitInstaller } from "./git.ts";
import { appProcesses } from "./processes.ts";
import { appHooks } from "./hooks.ts";
import { appState } from "./state.ts";
import { appStateSchema } from "./schema.ts";

/** Coordinate app installation without retaining caller environment or progress between operations. */
class AppInstaller {
  /** Lock the full app lifecycle and save successful installation before configuration for safe retries. */
  private async _installOne({
    context,
    app,
    force,
    closeApps,
    operation,
  }: {
    context: InstallContext;
    app: CatalogApp;
    force: boolean;
    closeApps: boolean;
    operation: "install" | "update";
  }) {
    if (process.getuid?.() === 0)
      throw new ApiError("INVALID_ENVIRONMENT", "Install apps as a normal user");
    const stateFile = join(context.env.LUNA_STATE_HOME_DIR!, "apps", `${app.id}.jsonc`);
    return locked({ configFile: stateFile, env: context.env }, async () => {
      if (operation === "update" && !(await appState.installed({ context, app })))
        throw new ApiError("INVALID_ARGUMENT", `App is not installed: ${app.id}`);
      if (closeApps) await appProcesses.close({ context, app });
      const original = await readOptional(stateFile);
      const saved = original
        ? validate(appStateSchema, parse(original, stateFile), stateFile)
        : undefined;
      const previous =
        saved?.name === app.manifest.name && saved.source === app.manifest.source
          ? saved
          : undefined;
      // Each app gets its own environment so build hooks cannot leak LUNA_PACKAGE_VERSION to the next app.
      const local = new InstallContext(
        context.repository,
        context.home,
        { ...context.env },
        context.onProgress,
        context.log,
      );
      local.progress(`${operation === "update" ? "Updating" : "Installing"} ${app.id}...`);
      await installPackages(local, app.manifest.deps ?? []);
      let revision: string | undefined;
      if (app.manifest.source === "git")
        revision = (
          await appGitInstaller.install({
            context: local,
            app,
            previousRevision: previous?.revision,
            force,
          })
        ).revision;
      else
        await this._installPackage({
          context: local,
          app,
          previouslyInstalled: Boolean(previous),
          force: force || operation === "update",
        });
      await writeFile(
        stateFile,
        JSON.stringify({
          name: app.manifest.name,
          source: app.manifest.source,
          ...(revision ? { revision } : {}),
        }) + "\n",
        original,
      );
      await appConfigurator.configure({ context: local, app });
      if (app.manifest.source === "git")
        await appGitInstaller.cleanBuild({ context: local, app, revision: revision! });
      return app.id;
    });
  }

  /**
   * Validate the entire catalog before installation and preserve its order for selected apps.
   * Hold sudo credentials only for this batch; return recorded app failures when skipFailed is set.
   */
  private async _run({
    context,
    names = [],
    force = false,
    skipFailed = false,
    closeApps = true,
    operation,
  }: {
    context: InstallContext;
    names?: string[];
    force?: boolean;
    skipFailed?: boolean;
    closeApps?: boolean;
    operation: "install" | "update";
  }): Promise<AppInstallResult> {
    const selected = await this._selectApps({ context, names, operation });
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
        let retry = `${quote(join(context.home, ".local/bin/luna"))} ${operation} ${quote(app.id)} --install-dir ${quote(context.repository)}`;
        if (force) retry += " --force";
        if (!closeApps) retry += " --no-close-apps";

        const completed = await attempt(context, app.id, retry, skipFailed, failed, () =>
          this._installOne({ context, app, force, closeApps, operation }),
        );
        if (completed) installed.push(app.id);
      }
      const result = {
        installed,
        failed,
        completed: failed.length === 0,
        logDirectory: context.log.directory,
      };
      context.log.finish(
        operation === "update"
          ? {
              updated: installed,
              failed,
              completed: result.completed,
              logDirectory: result.logDirectory,
            }
          : result,
      );
      return result;
    } finally {
      await stopSudo();
    }
  }

  /** Preserve source-specific installed checks and hook order; already-installed mise versions still activate. */
  private async _installPackage({
    context,
    app,
    previouslyInstalled,
    force,
  }: {
    context: InstallContext;
    app: CatalogApp;
    previouslyInstalled: boolean;
    force: boolean;
  }) {
    let installed = false;
    let installedMiseVersion: string | undefined;
    if (["pacman", "aur"].includes(app.manifest.source)) {
      const result = await context.execute(["pacman", "-Qq", "--", app.manifest.name], true);
      if (![0, 1].includes(result.exitCode)) throw new ApiError("COMMAND_FAILED", result.stderr);
      installed = result.exitCode === 0;
    } else if (app.manifest.source === "mise") {
      const request = app.manifest.version
        ? `${app.manifest.name}@${app.manifest.version}`
        : app.manifest.name;
      // Mise resolves aliases and partial versions against its installed tools.
      const result = await context.execute([
        "mise",
        "--cd",
        context.home,
        "latest",
        "--installed",
        request,
      ]);
      installedMiseVersion = result.stdout.trim() || undefined;
      installed = Boolean(installedMiseVersion);
    } else installed = previouslyInstalled;
    if (!installed || force) {
      await appHooks.run({ context, app, stage: "before_install" });
      if (app.manifest.source === "local") {
        await appHooks.run({ context, app, stage: "before_build" });
        await appHooks.run({ context, app, stage: "build" });
        await appHooks.run({ context, app, stage: "after_build" });
      } else
        await installPackages(context, [
          {
            name: app.manifest.name,
            source: app.manifest.source as "pacman" | "aur" | "mise",
            ...(app.manifest.version ? { version: app.manifest.version } : {}),
          },
        ]);
      await appHooks.run({ context, app, stage: "after_install" });
    } else if (app.manifest.source === "mise") {
      await installPackages(context, [
        { name: app.manifest.name, source: "mise", version: installedMiseVersion! },
      ]);
    }
  }

  /** Include the indexed Yay provider when needed, and require it to precede every selected AUR dependency. */
  private async _selectApps({
    context,
    names,
    operation,
  }: {
    context: InstallContext;
    names: string[];
    operation: "install" | "update";
  }) {
    const catalog = await appCatalog.read(context);
    let selected = appCatalog.select({ apps: catalog, names });
    if (operation === "update") {
      const installed: CatalogApp[] = [];
      for (const app of selected) {
        if (await appState.installed({ context, app })) installed.push(app);
        else if (names.length)
          throw new ApiError("INVALID_ARGUMENT", `App is not installed: ${app.id}`);
      }
      selected = installed;
    }
    if (
      selected.some(
        (app) =>
          app.manifest.source === "aur" || app.manifest.deps?.some((dep) => dep.source === "aur"),
      ) &&
      !Bun.which("yay", { PATH: context.env.PATH })
    ) {
      if (operation === "update")
        throw new ApiError("INVALID_ENVIRONMENT", "Install yay before updating AUR apps");
      const provider = catalog.find((app) => app.manifest.name === "yay");
      if (!provider) throw new ApiError("INVALID_ENVIRONMENT", "AUR installation requires yay");
      const ids = new Set([...selected.map((app) => app.id), provider.id]);
      selected = catalog.filter((app) => ids.has(app.id));
      if (
        selected
          .slice(0, selected.indexOf(provider) + 1)
          .some(
            (app) =>
              app.manifest.source === "aur" ||
              app.manifest.deps?.some((dep) => dep.source === "aur"),
          )
      )
        throw new ApiError(
          "INVALID_METADATA",
          "The yay provider must precede AUR apps and dependencies in apps/apps.jsonc",
        );
    }
    return selected;
  }
  install(options: {
    context: InstallContext;
    names?: string[];
    force?: boolean;
    skipFailed?: boolean;
    closeApps?: boolean;
  }) {
    return this._run({ ...options, operation: "install" });
  }

  /** Update installed apps only; package databases are not refreshed and unchanged Git revisions are not rebuilt. */
  async update(options: {
    context: InstallContext;
    names?: string[];
    force?: boolean;
    skipFailed?: boolean;
    closeApps?: boolean;
  }) {
    const { installed, ...result } = await this._run({ ...options, operation: "update" });
    return { ...result, updated: installed };
  }
}

export const appInstaller = new AppInstaller();
