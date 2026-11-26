import { realpath } from "node:fs/promises";
import { join } from "pathe";
import { metadata } from "@/lib/files.ts";
import { quickshell, type QuickshellContext } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";
import type { WallpaperContext, WallpaperState } from "./config.ts";
import { wallpaperSettingsSchema, type WallpaperSettings } from "./schema.ts";

/** Every command is scoped to this renderer; media paths and JSON snapshots stay single arguments. */
export type RendererContext = WallpaperContext & QuickshellContext;

class WallpaperRenderer {
  /** Require the renderer's shell.qml and Quickshell; both failures throw ApiError. */
  async resolve(context: WallpaperContext): Promise<RendererContext> {
    if (
      !context.shellDirectory ||
      !(await metadata(join(context.shellDirectory, "shell.qml")))?.isFile()
    )
      throw new ApiError(
        "INVALID_PATH",
        `Wallpaper shell is missing: ${context.shellDirectory ?? "set HOME or a checkout path"}`,
      );
    const executable = quickshell.executable({ env: context.env, feature: "Luna's wallpaper" });
    return { ...context, shellDirectory: await realpath(context.shellDirectory), executable };
  }

  async state(context: RendererContext): Promise<WallpaperState> {
    const result = await this._ipc({ context, method: "status", allowFailure: true });
    const status = result.code !== 0 ? "stopped" : result.stdout;
    if (status !== "stopped" && status !== "loading" && status !== "ready" && status !== "error")
      throw new ApiError("COMMAND_FAILED", `Unexpected wallpaper status: ${status}`);
    return {
      running: status !== "stopped",
      status,
      shellDirectory: context.shellDirectory,
      configFile: context.configFile,
    };
  }

  /** The active snapshot can differ from disk after direct edits without reload. */
  async snapshot(context: RendererContext): Promise<WallpaperSettings | null> {
    const result = await this._ipc({ context, method: "snapshot" });
    try {
      const value: unknown = JSON.parse(result.stdout);
      return value === null ? null : wallpaperSettingsSchema.parse(value);
    } catch (error) {
      throw new ApiError("COMMAND_FAILED", `Invalid wallpaper renderer snapshot: ${String(error)}`);
    }
  }

  /**
   * Return the playing source without making offline library operations depend on
   * Quickshell: a missing renderer or Quickshell yields null.
   */
  async activeSource(context: WallpaperContext) {
    let renderer: RendererContext;
    try {
      renderer = await this.resolve(context);
    } catch (error) {
      if (error instanceof ApiError) return null;
      throw error;
    }
    return (await this.state(renderer)).running
      ? (await this.snapshot(renderer))?.wallpaper?.source
      : null;
  }

  /** Launch with `settings` as the initial snapshot and wait until media is ready. */
  async start({ context, settings }: { context: RendererContext; settings: WallpaperSettings }) {
    const bundledWatcher = join(context.shellDirectory, "watch.js");
    const watcher = (await metadata(bundledWatcher))?.isFile()
      ? bundledWatcher
      : join(context.shellDirectory, "../watch.ts");
    if (!(await metadata(watcher))?.isFile())
      throw new ApiError("INVALID_PATH", `Wallpaper config watcher is missing: ${watcher}`);
    // A compiled Luna CLI's process.execPath is Luna itself, not the Bun interpreter.
    const bun = Bun.which("bun", { PATH: context.env.PATH ?? "" });
    if (!bun)
      throw new ApiError("COMMAND_FAILED", "Install Bun to run the wallpaper config watcher");
    await quickshell.command({
      context: {
        ...context,
        env: {
          ...context.env,
          LUNA_WALLPAPER_SETTINGS: JSON.stringify(settings),
          LUNA_WALLPAPER_WATCH_COMMAND: JSON.stringify([bun, watcher, context.configFile]),
        },
      },
      args: ["--no-color", "--daemonize", "--no-duplicate", "-p", context.shellDirectory],
      label: "Wallpaper",
    });
    return this._ready(context);
  }

  /** Kill a running renderer and wait up to 3s for its IPC to stop answering. */
  async stop(context: RendererContext) {
    if ((await this.state(context)).running)
      await quickshell.command({
        context,
        args: ["kill", "-p", context.shellDirectory],
        label: "Wallpaper",
      });
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const current = await this.state(context);
      if (!current.running) return current;
      await Bun.sleep(50);
    }
    throw new ApiError("COMMAND_FAILED", "Wallpaper did not stop");
  }

  /** Acceptance is synchronous; decoding and player changes finish before success is reported. */
  async reload({ context, settings }: { context: RendererContext; settings: WallpaperSettings }) {
    const result = await this._ipc({
      context,
      method: "reload",
      args: [JSON.stringify(settings)],
    });
    if (result.stdout !== "ok")
      throw new ApiError("COMMAND_FAILED", `Wallpaper reload rejected: ${result.stdout}`);
    return this._ready(context);
  }

  private async _ready(context: RendererContext) {
    // Probing/images allow 20s; video can then need another 15s. Leave room for
    // process startup and IPC so the renderer owns media failure decisions.
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const current = await this.state(context);
      if (current.status === "ready") return current;
      if (current.status === "error")
        throw new ApiError(
          "COMMAND_FAILED",
          "Wallpaper media failed to load; inspect the Quickshell log",
        );
      await Bun.sleep(50);
    }
    throw new ApiError(
      "COMMAND_FAILED",
      "Wallpaper did not become ready; inspect the Quickshell log",
    );
  }

  private _ipc({
    context,
    method,
    args,
    allowFailure,
  }: {
    context: RendererContext;
    method: string;
    args?: string[];
    allowFailure?: boolean;
  }) {
    return quickshell.ipc({
      context,
      target: "wallpaper",
      method,
      args,
      label: "Wallpaper",
      allowFailure,
    });
  }
}

export const wallpaperRenderer = new WallpaperRenderer();
