import { join } from "pathe";
import { parse, readOptional } from "@/lib/files.ts";
import { validate } from "@/lib/validation.ts";
import { ApiError } from "@/lib/response.ts";
import type { InstallContext } from "@/self/install/command.ts";
import type { CatalogApp } from "./catalog.ts";
import { appStateSchema } from "./schema.ts";

class AppStateStore {
  path({ context, app }: { context: InstallContext; app: CatalogApp }) {
    return join(context.env.LUNA_STATE_HOME_DIR!, "apps", `${app.id}.jsonc`);
  }

  /** Query the package manager for packages; Git/local installs use Luna's recorded identity. */
  async installed({ context, app }: { context: InstallContext; app: CatalogApp }) {
    if (app.manifest.source === "pacman" || app.manifest.source === "aur") {
      const result = await context.execute(["pacman", "-Qq", "--", app.manifest.name], true);
      if (![0, 1].includes(result.exitCode)) throw new ApiError("COMMAND_FAILED", result.stderr);
      return result.exitCode === 0;
    }
    if (app.manifest.source === "mise") {
      const result = await context.execute([
        "mise",
        "--cd",
        context.home,
        "latest",
        "--installed",
        app.manifest.name,
      ]);
      return Boolean(result.stdout.trim());
    }
    const path = this.path({ context, app });
    const source = await readOptional(path);
    if (!source) return false;
    const state = validate(appStateSchema, parse(source, path), path);
    return state.name === app.manifest.name && state.source === app.manifest.source;
  }
}

export const appState = new AppStateStore();
