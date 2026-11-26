import { isAbsolute, join, resolve } from "pathe";
import { environment, lunaConfigHome } from "@/lib/env.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";

export interface LoginOptions {
  configFile?: string;
  /** Use this checkout's greeter and screens instead of the installed sources. */
  repository?: string;
  /** SDDM's filesystem root; defaults to /. Useful for offline installations. */
  systemRoot?: string;
  env?: Record<string, string>;
}

export interface LoginState {
  installed: boolean;
  selected: boolean;
  configFile: string;
  themeDirectory: string;
}

export interface LoginContext {
  env: Record<string, string>;
  configFile: string;
  sourceDirectory?: string;
  wallpaperFile?: string;
  systemRoot: string;
  themeDirectory: string;
  sddmConfigFile: string;
}

class LoginContextResolver {
  private _path(value: string) {
    if (!value || hasControlCharacters(value) || resolve(value) === "/")
      throw new ApiError(
        "INVALID_PATH",
        "Login paths must be nonempty and cannot be the filesystem root",
      );
    return resolve(value);
  }

  /** Resolve each call independently; settings reads need neither SDDM nor installed QML. */
  resolve(options: LoginOptions = {}): LoginContext {
    const env = environment(options.env);
    const configHome = lunaConfigHome(env);
    const dataHome =
      env.LUNA_DATA_HOME_DIR ||
      (env.XDG_DATA_HOME
        ? join(env.XDG_DATA_HOME, "luna")
        : env.HOME
          ? join(env.HOME, ".local/share/luna")
          : undefined);
    for (const home of [configHome, dataHome])
      if (home && (!isAbsolute(home) || resolve(home) === "/" || hasControlCharacters(home)))
        throw new ApiError(
          "INVALID_PATH",
          "Login configuration and data homes must be absolute non-root paths",
        );
    const file =
      options.configFile ??
      (env.LUNA_LOGIN_CONFIG || (configHome ? join(configHome, "login.jsonc") : undefined));
    if (!file) throw new ApiError("INVALID_PATH", "Set a login config file or HOME");
    const root = options.systemRoot ?? env.LUNA_LOGIN_SYSTEM_ROOT ?? "/";
    if (!root || !isAbsolute(root) || hasControlCharacters(root))
      throw new ApiError("INVALID_PATH", "SDDM's system root must be an absolute path");
    const systemRoot = resolve(root);
    return {
      env,
      configFile: this._path(file),
      systemRoot,
      sourceDirectory: options.repository
        ? this._path(join(this._path(options.repository), "src/luna-login/src"))
        : configHome
          ? join(configHome, "login")
          : undefined,
      wallpaperFile: dataHome ? join(dataHome, "login/background") : undefined,
      themeDirectory: join(systemRoot, "usr/share/sddm/themes/luna"),
      sddmConfigFile: join(systemRoot, "etc/sddm.conf"),
    };
  }

  source(context: LoginContext) {
    if (!context.sourceDirectory)
      throw new ApiError("INVALID_PATH", "Install Luna Login sources or select a checkout");
    return context.sourceDirectory;
  }
}
export const loginContext = new LoginContextResolver();
