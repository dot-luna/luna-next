import { realpath } from "node:fs/promises";
import { join } from "pathe";
import { metadata } from "../lib/files.ts";
import { ApiError } from "../lib/response.ts";
import type { WallpaperContext, WallpaperState } from "./context.ts";
import type { WallpaperSettings } from "./schema.ts";

export async function rendererContext(context: WallpaperContext) {
  if (
    !context.shellDirectory ||
    !(await metadata(join(context.shellDirectory, "shell.qml")))?.isFile()
  )
    throw new ApiError(
      "INVALID_PATH",
      `Wallpaper shell is missing: ${context.shellDirectory ?? "set HOME or a checkout path"}`,
    );
  const executable =
    Bun.which("qs", { PATH: context.env.PATH }) ??
    Bun.which("quickshell", { PATH: context.env.PATH });
  if (!executable)
    throw new ApiError("COMMAND_FAILED", "Install Quickshell to use Luna's wallpaper");
  return { ...context, shellDirectory: await realpath(context.shellDirectory), executable };
}

export type RendererContext = Awaited<ReturnType<typeof rendererContext>>;

/** Scope every command to this renderer; media paths and JSON snapshots remain single arguments. */
export async function command(context: RendererContext, args: string[], allowFailure = false) {
  const child = Bun.spawn([context.executable, ...args], {
    env: context.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 && !allowFailure)
    throw new ApiError(
      "COMMAND_FAILED",
      `Wallpaper command failed (${code}): ${(stderr || stdout).trim()}`,
    );
  return { code, stdout: stdout.trim() };
}

function ipc(context: RendererContext, method: string, args: string[] = [], allowFailure = false) {
  return command(
    context,
    ["ipc", "-p", context.shellDirectory, "call", "--", "wallpaper", method, ...args],
    allowFailure,
  );
}

export async function state(context: RendererContext): Promise<WallpaperState> {
  const result = await ipc(context, "status", [], true);
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

async function ready(context: RendererContext) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const current = await state(context);
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

export async function start(context: RendererContext, settings: WallpaperSettings) {
  await command(
    { ...context, env: { ...context.env, LUNA_WALLPAPER_SETTINGS: JSON.stringify(settings) } },
    ["--no-color", "--daemonize", "--no-duplicate", "-p", context.shellDirectory],
  );
  return ready(context);
}

export async function stop(context: RendererContext) {
  if ((await state(context)).running)
    await command(context, ["kill", "-p", context.shellDirectory]);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const current = await state(context);
    if (!current.running) return current;
    await Bun.sleep(50);
  }
  throw new ApiError("COMMAND_FAILED", "Wallpaper did not stop");
}

/** Acceptance is synchronous; decoding and player changes finish before success is reported. */
export async function reload(context: RendererContext, settings: WallpaperSettings) {
  const result = await ipc(context, "reload", [JSON.stringify(settings)]);
  if (result.stdout !== "ok")
    throw new ApiError("COMMAND_FAILED", `Wallpaper reload rejected: ${result.stdout}`);
  return ready(context);
}
