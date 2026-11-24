import { metadata } from "@/lib/files.ts";
import { capture } from "@/lib/process.ts";
import { quickshell } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";
import { themeSelection } from "@/modules/theme/selection.ts";
import { themeContext } from "@/modules/theme/context.ts";
import {
  desktopLockSchema,
  screensaverSettingsSchema,
  type ScreensaverSettings,
} from "./schema.ts";
import type { ScreensaverRenderer, ScreensaverState } from "./context.ts";

class ScreensaverRuntime {
  ipc({
    context,
    method,
    args,
    allowFailure,
  }: {
    context: ScreensaverRenderer;
    method: string;
    args?: string[];
    allowFailure?: boolean;
  }) {
    return quickshell.ipc({
      context,
      target: "screensaver",
      method,
      args,
      label: "Screensaver",
      allowFailure,
    });
  }

  /** A failed status call means no shell is listening, which reports as stopped. */
  async state(context: ScreensaverRenderer): Promise<ScreensaverState> {
    const response = await this.ipc({ context, method: "status", allowFailure: true });
    const status = response.code !== 0 ? "stopped" : response.stdout;
    if (status !== "stopped" && status !== "hidden" && status !== "visible")
      throw new ApiError("COMMAND_FAILED", `Unexpected screensaver status: ${status}`);
    return {
      running: status !== "stopped",
      status,
      shellDirectory: context.shellDirectory,
      configFile: context.configFile,
    };
  }

  /** Daemonize the shell with settings, a theme snapshot and the launcher it runs on idle. */
  async start({
    context,
    settings,
  }: {
    context: ScreensaverRenderer;
    settings: ScreensaverSettings;
  }) {
    if (!context.launcher || !(await metadata(context.launcher))?.isFile())
      throw new ApiError(
        "INVALID_PATH",
        "Build/install the Luna CLI or supply a screensaver launcher",
      );
    const args = [context.launcher, "screensaver", "--config", context.configFile];
    if (context.repository) args.push("--install-dir", context.repository);
    const env = {
      ...context.env,
      LUNA_SCREENSAVER_SETTINGS: JSON.stringify(settings),
      LUNA_SCREENSAVER_THEME: JSON.stringify(await this._theme(context)),
      LUNA_SCREENSAVER_COMMAND: JSON.stringify(args),
    };
    await quickshell.command({
      context: { ...context, env },
      args: ["--no-color", "--daemonize", "--no-duplicate", "-p", context.shellDirectory],
      label: "Screensaver",
    });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const current = await this.state(context);
      if (current.running) return current;
      await Bun.sleep(50);
    }
    throw new ApiError(
      "COMMAND_FAILED",
      "Screensaver did not become ready; inspect the Quickshell log",
    );
  }

  /** The screensaver holds no secure state, so stopping kills its Quickshell instance. */
  async stop(context: ScreensaverRenderer) {
    if ((await this.state(context)).running)
      await quickshell.command({
        context,
        args: ["kill", "-p", context.shellDirectory],
        label: "Screensaver",
      });
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const current = await this.state(context);
      if (!current.running) return current;
      await Bun.sleep(50);
    }
    throw new ApiError("COMMAND_FAILED", "Screensaver did not stop");
  }

  /** Apply settings with a fresh theme snapshot to the running shell. */
  async reload({
    context,
    settings,
  }: {
    context: ScreensaverRenderer;
    settings: ScreensaverSettings;
  }) {
    const response = await this.ipc({
      context,
      method: "reload",
      args: [JSON.stringify(settings), JSON.stringify(await this._theme(context))],
    });
    if (response.stdout !== "ok")
      throw new ApiError("COMMAND_FAILED", `Screensaver rejected settings: ${response.stdout}`);
    return this.state(context);
  }

  /** Settings the running shell currently applies, used to roll back a rejected reload. */
  async snapshot(context: ScreensaverRenderer) {
    const response = await this.ipc({ context, method: "snapshot" });
    try {
      return screensaverSettingsSchema.parse(JSON.parse(response.stdout));
    } catch (error) {
      throw new ApiError("COMMAND_FAILED", `Invalid screensaver snapshot: ${String(error)}`);
    }
  }

  /** A screensaver is presentation only; never place it over a secure Hyprland lock. */
  async sessionLocked(context: ScreensaverRenderer) {
    if (!context.env.HYPRLAND_INSTANCE_SIGNATURE) return false;
    const executable = Bun.which("hyprctl", { PATH: context.env.PATH });
    if (!executable)
      throw new ApiError("COMMAND_FAILED", "Hyprctl is required to inspect this Hyprland session");
    const { code, stdout, stderr } = await capture({
      args: [executable, "-j", "locked"],
      env: context.env,
      timeout: 5000,
    });
    if (code !== 0)
      throw new ApiError(
        "COMMAND_FAILED",
        `Screensaver command failed (${code}): ${(stderr || stdout).trim()}`,
      );
    try {
      return desktopLockSchema.parse(JSON.parse(stdout.trim())).locked;
    } catch (error) {
      throw new ApiError("COMMAND_FAILED", `Cannot read the session lock state: ${String(error)}`);
    }
  }

  private _theme(context: ScreensaverRenderer) {
    return themeSelection.current(themeContext.resolve({ env: context.env }));
  }
}

export const screensaverRuntime = new ScreensaverRuntime();
