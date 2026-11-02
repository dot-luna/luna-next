import { ApiError } from "../lib/response.ts";
import { command, type ThemeContext } from "./context.ts";
import type { ResolvedTheme } from "./types.ts";

/** Check system package presence without requiring the tool that originally installed it. */
export async function missingThemePackages(
  context: ThemeContext,
  packages: NonNullable<ResolvedTheme["packages"]> = [],
) {
  if (!packages.length) return [];
  if (!Bun.which("pacman", { PATH: context.env.PATH }))
    throw new ApiError("INVALID_ENVIRONMENT", "Theme package checks require pacman");
  const missing: typeof packages = [];
  for (const item of packages) {
    const child = Bun.spawn(["pacman", "-Qq", "--", item.name], {
      env: context.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (status === 1) missing.push(item);
    else if (status !== 0)
      throw new ApiError(
        "COMMAND_FAILED",
        `Cannot check theme package ${item.name}: ${stderr.trim()}`,
      );
  }
  return missing;
}

/** Install only missing prerequisites before publication or activation; reads never install. */
export async function installThemePackages(
  context: ThemeContext,
  packages: NonNullable<ResolvedTheme["packages"]> = [],
) {
  const missing = await missingThemePackages(context, packages);
  const tools = [
    ...(missing.some((item) => item.source === "pacman") ? ["sudo"] : []),
    ...(missing.some((item) => item.source === "aur") ? ["yay"] : []),
  ];
  for (const tool of tools)
    if (!Bun.which(tool, { PATH: context.env.PATH }))
      throw new ApiError(
        "INVALID_ENVIRONMENT",
        `Missing theme packages require ${tool}; install it first`,
      );
  const official = missing.filter((item) => item.source === "pacman").map((item) => item.name);
  if (official.length)
    await command(context, ["sudo", "pacman", "-S", "--needed", "--noconfirm", "--", ...official]);
  for (const item of missing.filter((item) => item.source === "aur"))
    await command(context, ["yay", "-S", "--needed", "--noconfirm", "--", item.name]);
}
