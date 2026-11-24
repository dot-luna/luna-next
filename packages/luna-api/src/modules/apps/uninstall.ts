import { rm } from "node:fs/promises";
import { join } from "pathe";
import { ApiError } from "@/lib/response.ts";
import { locked, metadata, readOptional } from "@/lib/files.ts";
import { ordinaryParents } from "@/lib/paths.ts";
import { installReport, type InstallFailure } from "@/modules/self/install/report.ts";
import { InstallContext } from "@/modules/self/install/command.ts";
import { appCatalog, type CatalogApp } from "./catalog.ts";
import { appCleanup } from "./cleanup.ts";
import { appHooks } from "./hooks.ts";
import { appProcesses } from "./processes.ts";
import { appState } from "./state.ts";

class AppUninstaller {
  /** Package managers retain dependencies. Mise prunes only versions unused by other tracked configs. */
  private async _removePackage({ context, app }: { context: InstallContext; app: CatalogApp }) {
    if (app.manifest.source === "pacman" || app.manifest.source === "aur") {
      if (await appState.installed({ context, app }))
        await context.execute(["sudo", "pacman", "-R", "--noconfirm", "--", app.manifest.name]);
    } else if (app.manifest.source === "mise") {
      await context.execute([
        "mise",
        "--cd",
        context.home,
        "unuse",
        "--global",
        "--yes",
        app.manifest.name,
      ]);
    }
  }

  /** Keep the app state until cleanup succeeds so failed removals remain retryable. */
  private async _uninstallOne({
    context: parent,
    app,
    paths,
    closeApps,
  }: {
    context: InstallContext;
    app: CatalogApp;
    paths: string[];
    closeApps: boolean;
  }) {
    const context = new InstallContext(
      parent.repository,
      parent.home,
      { ...parent.env, LUNA_CLOSE_APPS: closeApps ? "1" : "0" },
      parent.onProgress,
      parent.log,
    );
    const stateFile = appState.path({ context, app });
    await ordinaryParents(stateFile);
    for (const path of [stateFile, stateFile + ".lock"]) {
      const info = await metadata(path);
      if (info && !info.isFile())
        throw new ApiError("INVALID_PATH", `App state must be an ordinary file: ${path}`);
    }
    return locked({ configFile: stateFile, env: context.env }, async () => {
      const previous = await readOptional(stateFile);
      if (closeApps) await appProcesses.close({ context, app });
      await appHooks.run({ context, app, stage: "before_uninstall" });
      context.progress(`Uninstalling ${app.id}...`);
      await this._removePackage({ context, app });
      // Custom installers own external artifacts; these hooks must also accept an already-removed app.
      await appHooks.run({ context, app, stage: "uninstall" });
      await appCleanup.remove(paths);
      await appHooks.run({ context, app, stage: "after_uninstall" });
      if ((await readOptional(stateFile)) !== previous)
        throw new ApiError("CONFLICT", `App state changed externally: ${stateFile}`);
      // Keep the lock file so waiting and future operations lock the same inode.
      await rm(stateFile, { force: true });
      return app.id;
    });
  }

  /** Require explicit names. Purge plans come from the catalog, so they work after the state/package is gone. */
  async uninstall({
    context,
    names,
    purge = false,
    skipFailed = false,
    closeApps = true,
  }: {
    context: InstallContext;
    names: string[];
    purge?: boolean;
    skipFailed?: boolean;
    closeApps?: boolean;
  }) {
    if (!names.length)
      throw new ApiError("INVALID_ARGUMENT", "Provide at least one app to uninstall");
    if (process.getuid?.() === 0)
      throw new ApiError("INVALID_ENVIRONMENT", "Uninstall apps as a normal user");
    const catalog = await appCatalog.read(context);
    const selected = appCatalog.select({ apps: catalog, names });
    // Resolve every deletion before invoking hooks or package managers.
    const plans: { app: CatalogApp; paths: string[] }[] = [];
    for (const app of selected) {
      const paths = await appCleanup.plan({ context, app, catalog, purge });
      plans.push({ app, paths });
    }

    let stopSudo = async () => {};
    let needsPrivileges = false;
    // A later purge of an absent package should not prompt for sudo.
    for (const app of selected) {
      if (app.manifest.source !== "pacman" && app.manifest.source !== "aur") continue;
      if (await appState.installed({ context, app })) needsPrivileges = true;
    }
    if (needsPrivileges) {
      await context.execute(["sudo", "-v"]);
      stopSudo = context.keepSudoAlive();
    }
    try {
      const uninstalled: string[] = [];
      const failed: InstallFailure[] = [];
      for (const { app, paths } of plans) {
        let retry = `${installReport.quote(join(context.home, ".local/bin/luna"))} uninstall ${installReport.quote(app.id)} --install-dir ${installReport.quote(context.repository)}`;
        if (purge) retry += " --purge";
        if (!closeApps) retry += " --no-close-apps";

        const removed = await installReport.attempt({
          context,
          app: app.id,
          retry,
          skipFailed,
          failed,
          operation: () => this._uninstallOne({ context, app, paths, closeApps }),
        });
        if (removed) uninstalled.push(app.id);
      }
      const result = {
        uninstalled,
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
}

export const appUninstaller = new AppUninstaller();
