import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "pathe";
import { environment, lunaConfigHome } from "@/lib/env.ts";
import { metadata } from "@/lib/files.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { quickshell, type QuickshellContext } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";

export interface ScreensaverOptions {
  env?: Record<string, string>;
  configFile?: string;
  /** Select source QML instead of the installed shell. */
  repository?: string;
  /** CLI used by native idle events; defaults to ~/.local/bin/luna. */
  launcher?: string;
}
export interface ScreensaverState {
  running: boolean;
  status: "stopped" | "hidden" | "visible";
  shellDirectory: string;
  configFile: string;
}

/** Validated per-call paths; shellDirectory is undefined without HOME or a checkout. */
export interface ScreensaverContext {
  env: Record<string, string>;
  configFile: string;
  repository?: string;
  launcher?: string;
  shellDirectory?: string;
}

/** A screensaver context whose Quickshell executable and shell directory are resolved. */
export interface ScreensaverRenderer extends ScreensaverContext, QuickshellContext {
  shellDirectory: string;
}

class ScreensaverContextResolver {
  /** Resolve fresh paths without touching the filesystem; caller env is copied, never retained. */
  resolve(options: ScreensaverOptions = {}): ScreensaverContext {
    const env = environment(options.env);
    const configHome = lunaConfigHome(env);
    if (configHome && !isAbsolute(configHome))
      throw new ApiError("INVALID_PATH", "Screensaver configuration home must be absolute");
    const file =
      options.configFile ??
      (env.LUNA_SCREENSAVER_CONFIG ||
        (configHome ? join(configHome, "screensaver.jsonc") : undefined));
    if (!file) throw new ApiError("INVALID_PATH", "Set a screensaver config file or HOME");
    const launcher = options.launcher ?? (env.HOME ? join(env.HOME, ".local/bin/luna") : undefined);
    const repository = options.repository ? this._path(options.repository) : undefined;
    return {
      env,
      configFile: this._path(file),
      repository,
      launcher: launcher ? this._path(launcher) : undefined,
      shellDirectory: repository
        ? join(repository, "src/luna-screensaver/src/shell")
        : configHome
          ? join(configHome, "screensaver")
          : undefined,
    };
  }

  /** Require an installed or checkout shell.qml and Quickshell; canonicalize the shell directory. */
  async renderer(context: ScreensaverContext): Promise<ScreensaverRenderer> {
    if (
      !context.shellDirectory ||
      !(await metadata(join(context.shellDirectory, "shell.qml")))?.isFile()
    )
      throw new ApiError(
        "INVALID_PATH",
        `Screensaver shell is missing: ${context.shellDirectory ?? "set HOME or a checkout"}`,
      );
    const executable = quickshell.executable({ env: context.env, feature: "Luna's screensaver" });
    return { ...context, executable, shellDirectory: await realpath(context.shellDirectory) };
  }

  private _path(value: string) {
    if (!value || hasControlCharacters(value) || resolve(value) === "/")
      throw new ApiError(
        "INVALID_PATH",
        "Screensaver paths must be nonempty and cannot be the filesystem root",
      );
    return resolve(value);
  }
}

export const screensaverContext = new ScreensaverContextResolver();
