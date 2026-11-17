import { rm } from "node:fs/promises";
import { join, resolve } from "pathe";
import { ApiError } from "@/lib/response.ts";
import { ordinaryParents, overlaps } from "@/lib/paths.ts";
import type { InstallContext } from "@/self/install/command.ts";
import type { CatalogApp } from "./catalog.ts";
import { appIntegration } from "./integration.ts";

class AppCleanup {
  /** Collect and validate declared paths without deleting anything. Personal paths require purge. */
  async plan({
    context,
    app,
    catalog,
    purge,
  }: {
    context: InstallContext;
    app: CatalogApp;
    catalog: CatalogApp[];
    purge: boolean;
  }) {
    const paths = [join(context.env.LUNA_CONFIG_HOME_DIR!, "aliases", `${app.id}.zsh`)];
    if (app.manifest.source === "git" || app.manifest.source === "local") {
      const root =
        app.manifest.source === "git"
          ? context.env.LUNA_GIT_APP_INSTALL_DIR!
          : context.env.LUNA_LOCAL_APP_INSTALL_DIR!;
      paths.push(join(root, app.manifest.name));
    }
    const candidates = [...(app.manifest.cleanup?.uninstall ?? [])];
    if (purge) {
      candidates.push(...(app.manifest.cleanup?.purge ?? []));
      for (const item of app.manifest.exports ?? []) {
        paths.push(join(context.env.LUNA_CONFIG_HOME_DIR!, item.target));
        if (item.user_config) candidates.push(item.user_config.dest);
      }
    }
    for (const choices of candidates) {
      const path = await appIntegration.resolveDestination({
        context,
        candidates: choices,
        cwd: app.directory,
      });
      paths.push(path);
    }

    const sharedRoots = [
      context.home,
      context.repository,
      join(context.home, ".local"),
      join(context.home, ".local/bin"),
    ];
    for (const [key, path] of Object.entries(context.env)) {
      if (/^LUNA_.*_DIR$/u.test(key) || /^XDG_(CONFIG|DATA|CACHE|STATE)_HOME$/u.test(key))
        sharedRoots.push(path);
    }

    const otherExports: string[] = [];
    for (const otherApp of catalog) {
      if (otherApp.id === app.id) continue;
      for (const entry of otherApp.manifest.exports ?? [])
        otherExports.push(join(context.env.LUNA_CONFIG_HOME_DIR!, entry.target));
    }

    const uniquePaths = [...new Set(paths.map((path) => resolve(path)))];
    for (const path of uniquePaths) {
      // App folders may live inside shared roots, but must not delete a root or its parent.
      const removesSharedRoot = sharedRoots.some(
        (root) => root === path || root.startsWith(path + "/"),
      );
      const overlapsOtherApp = otherExports.some((other) => overlaps(path, other));
      if (removesSharedRoot || overlaps(path, context.repository) || overlapsOtherApp)
        throw new ApiError(
          "INVALID_PATH",
          `Cleanup overlaps a shared or another app's path: ${path}`,
        );
      await ordinaryParents(path);
    }
    // Removing a folder also removes its nested exports; schedule that folder only once.
    return uniquePaths.filter(
      (path) => !uniquePaths.some((parent) => parent !== path && path.startsWith(parent + "/")),
    );
  }

  async remove(paths: string[]) {
    for (const path of paths) {
      // Recheck after hooks have run. A leaf symlink is unlinked, never followed.
      await ordinaryParents(path);
      await rm(path, { recursive: true, force: true });
    }
  }
}

export const appCleanup = new AppCleanup();
