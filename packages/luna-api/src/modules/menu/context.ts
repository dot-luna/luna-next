import { realpath } from "node:fs/promises";
import { isAbsolute, join } from "pathe";
import { environment, lunaConfigHome } from "@/lib/env.ts";
import { metadata } from "@/lib/files.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { quickshell, type QuickshellContext } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";

export interface MenuOptions {
  /** Select source QML from this checkout instead of the installed menu. */
  repository?: string;
  /** Replaces Bun.env for runtime paths, theme selection, and child processes. */
  env?: Record<string, string>;
}
export interface MenuState {
  running: boolean;
  shellDirectory: string;
}

export interface StayAwakeState {
  enabled: boolean;
}

/** The menu's Quickshell application; commands are scoped to its canonical shell directory. */
export type MenuContext = QuickshellContext;

class MenuContextResolver {
  /** Require an installed or checkout shell.qml and Quickshell; caller env is copied, never retained. */
  async resolve(options: MenuOptions): Promise<MenuContext> {
    const env = environment(options.env);
    const config = lunaConfigHome(env);
    const shell = options.repository
      ? join(options.repository, "src/luna-menu/src/shell")
      : config
        ? join(config, "menu")
        : undefined;
    if (!shell || !isAbsolute(shell) || hasControlCharacters(shell))
      throw new ApiError(
        "INVALID_PATH",
        "The menu requires an absolute configuration or checkout path",
      );
    if (!(await metadata(join(shell, "shell.qml")))?.isFile())
      throw new ApiError("INVALID_PATH", `Menu shell is missing: ${shell}`);
    const executable = quickshell.executable({ env, feature: "Luna's menu" });
    return { env, executable, shellDirectory: await realpath(shell) };
  }
}

export const menuContext = new MenuContextResolver();
