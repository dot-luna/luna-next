import { realpath } from "node:fs/promises";
import { isAbsolute, join } from "pathe";
import { environment, lunaConfigHome } from "@/lib/env.ts";
import { metadata } from "@/lib/files.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { quickshell, type QuickshellContext } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";

export interface BarOptions {
  /** Select source QML from this checkout instead of the installed bar. */
  repository?: string;
  /** Replaces Bun.env for runtime paths, theme selection, and child processes. */
  env?: Record<string, string>;
}

export interface BarState {
  running: boolean;
  shellDirectory: string;
}

/** The canonical bar shell directory scopes every Quickshell command. */
export type BarContext = QuickshellContext;

class BarContextResolver {
  /** Resolve fresh paths, require the shell's shell.qml, then locate Quickshell. */
  async resolve(options: BarOptions): Promise<BarContext> {
    const env = environment(options.env);
    const config = lunaConfigHome(env);
    const shell = options.repository
      ? join(options.repository, "src/luna-bar/src/shell")
      : config
        ? join(config, "bar")
        : undefined;
    if (!shell || !isAbsolute(shell) || hasControlCharacters(shell))
      throw new ApiError(
        "INVALID_PATH",
        "The bar requires an absolute configuration or checkout path",
      );
    if (!(await metadata(join(shell, "shell.qml")))?.isFile())
      throw new ApiError("INVALID_PATH", `Bar shell is missing: ${shell}`);
    const executable = quickshell.executable({ env, feature: "Luna's bar" });
    return { env, executable, shellDirectory: await realpath(shell) };
  }
}

export const barContext = new BarContextResolver();
