import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { locked } from "@/lib/files.ts";
import { capture } from "@/lib/process.ts";
import { ApiError, respond } from "@/lib/response.ts";
import { loginBuilder } from "./build.ts";
import { loginContext, type LoginOptions } from "./context.ts";
import { loginDeployment } from "./deployment.ts";
import { loginSddm } from "./sddm.ts";
import { loginSettings } from "./settings.ts";
import { loginWallpaper } from "./wallpaper.ts";

/** Standalone SDDM themes; install and configuration never restart the display manager. */
class Login {
  build(output: string, options: LoginOptions = {}) {
    return respond(() => {
      const context = loginContext.resolve(options);
      return locked(context, () =>
        loginBuilder.build({
          configFile: context.configFile,
          sourceDirectory: loginContext.source(context),
          output,
          env: context.env,
        }),
      );
    });
  }

  /** Run SDDM test mode until its window closes, then remove the disposable bundle. */
  preview(options: LoginOptions = {}) {
    return respond(async () => {
      const context = loginContext.resolve(options);
      const executable = Bun.which("sddm-greeter-qt6", { PATH: context.env.PATH });
      if (!executable)
        throw new ApiError("COMMAND_FAILED", "Install the Qt 6 SDDM greeter to preview Login");
      const temporary = await mkdtemp(join(tmpdir(), "luna-login-preview-"));
      try {
        const bundle = await locked(context, () =>
          loginBuilder.build({
            configFile: context.configFile,
            sourceDirectory: loginContext.source(context),
            output: join(temporary, "theme"),
            env: context.env,
          }),
        );
        const result = await capture({
          args: [executable, "--test-mode", "--theme", bundle],
          env: context.env,
        });
        if (result.code !== 0)
          throw new ApiError(
            "COMMAND_FAILED",
            result.stderr || result.stdout || "SDDM preview failed",
          );
        return { configFile: context.configFile };
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    });
  }

  /** Deploy and select Luna for the next greeter. System writes use sudo when needed. */
  install(options: LoginOptions = {}) {
    return respond(() => {
      const context = loginContext.resolve(options);
      return locked(context, () => loginDeployment.install({ context, select: true }));
    });
  }

  uninstall(options: LoginOptions = {}) {
    return respond(() => {
      const context = loginContext.resolve(options);
      return locked(context, () => loginDeployment.uninstall(context));
    });
  }

  status(options: LoginOptions = {}) {
    return respond(() => loginSddm.state(loginContext.resolve(options)));
  }

  /** Return saved settings or a dot-separated key; omitted values return null. */
  getConfig(key?: string, options: LoginOptions = {}) {
    return respond(() => loginSettings.get({ context: loginContext.resolve(options), key }));
  }

  getConfigFile(options: LoginOptions = {}) {
    return respond(() => loginContext.resolve(options).configFile);
  }

  /** Save a validated patch, refresh an installed theme, and recover the source if deployment fails. */
  updateConfig(patch: unknown, options: LoginOptions = {}) {
    return respond(() => {
      const context = loginContext.resolve(options);
      return locked(context, async () => {
        const previous = await loginSettings.read(context);
        const value = loginSettings.patch({ previous: previous.value, patch });
        const installed = (await loginSddm.state(context)).installed;
        return loginSettings.save({
          context,
          previous,
          value,
          apply: async () => {
            if (installed) await loginDeployment.install({ context, select: false });
          },
        });
      });
    });
  }

  /** Copy one local image into managed storage and refresh Login only. */
  setWallpaper(source: string, options: LoginOptions = {}) {
    return respond(() => {
      const context = loginContext.resolve(options);
      return locked(context, () => loginWallpaper.set({ context, source }));
    });
  }
}

export const login = new Login();
