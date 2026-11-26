import { join } from "pathe";
import { locked, writeFile } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import type { InstallContext } from "@/modules/self/install/command.ts";
import type { DefaultsResult } from "./context.ts";
import { desktopCatalog } from "./desktop.ts";
import { desktopPreferences } from "./preferences.ts";
import { loginShell } from "./shell.ts";

class DefaultsApplier {
  /**
   * Apply validated choices under the defaults lock. Every application, wildcard and shell is
   * resolved before anything changes; then the login shell is set and preference files are
   * saved one by one, so an I/O failure can leave earlier changes applied.
   */
  async apply({
    context,
    selected,
    configured = selected,
    shellsFile,
  }: {
    context: InstallContext;
    selected: Record<string, string>;
    /** The whole manifest; its exact MIME keys are left out of wildcard expansion. */
    configured?: Record<string, string>;
    shellsFile?: string;
  }): Promise<DefaultsResult> {
    return locked(
      { configFile: join(context.env.LUNA_STATE_HOME_DIR!, "defaults"), env: context.env },
      async () => {
        const catalog = await desktopCatalog.entries({ context, keys: Object.keys(selected) });
        const choices: Record<string, string> = {};
        let shell: Awaited<ReturnType<typeof loginShell.prepare>> | undefined;
        for (const [key, value] of Object.entries(selected)) {
          if (key === "shell") {
            shell = await loginShell.prepare({ context, value, shellsFile });
            continue;
          }
          const entry = catalog.get(value);
          if (!entry?.available)
            throw new ApiError(
              "INVALID_ARGUMENT",
              `Default ${key} requires an installed application: ${value}`,
            );
          if (key === "terminal") {
            if (!entry.terminal)
              throw new ApiError(
                "INVALID_ARGUMENT",
                `${value} must declare TerminalEmulator and [X-]TerminalArgExec`,
              );
            if (!Bun.which("xdg-terminal-exec", { PATH: context.env.PATH }))
              throw new ApiError(
                "INVALID_ENVIRONMENT",
                "Install xdg-terminal-exec before selecting a default terminal",
              );
          }
          const types = desktopCatalog.mimeTypes({ key, entry, configured });
          if (!desktopCatalog.supportedTypes({ key, entry }).length)
            throw new ApiError(
              "INVALID_ARGUMENT",
              `${value} advertises no supported types for ${key}`,
            );
          for (const type of types) choices[type] = value;
        }
        const writes = await desktopPreferences.prepare({ context, choices });
        if (shell) await shell.apply();
        for (const write of writes) await writeFile(write.path, write.contents, write.previous);
        const applied = { ...choices };
        if (shell) applied.shell = shell.selected;
        return { applied };
      },
    );
  }
}

export const defaultsApplier = new DefaultsApplier();
