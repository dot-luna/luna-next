import { capture } from "@/lib/process.ts";
import { ApiError } from "@/lib/response.ts";
import { themeCommand } from "./command.ts";
import type { ThemeContext } from "./context.ts";
import type { ResolvedTheme } from "./schema.ts";

type ThemePackage = NonNullable<ResolvedTheme["packages"]>[number];

class ThemePackages {
  /** Check system package presence without requiring the tool that originally installed it. */
  async missing({ context, packages = [] }: { context: ThemeContext; packages?: ThemePackage[] }) {
    if (!packages.length) return [];
    if (!Bun.which("pacman", { PATH: context.env.PATH }))
      throw new ApiError("INVALID_ENVIRONMENT", "Theme package checks require pacman");
    const missing: ThemePackage[] = [];
    for (const item of packages) {
      const result = await capture({ args: ["pacman", "-Qq", "--", item.name], env: context.env });
      if (result.code === 1) missing.push(item);
      else if (result.code !== 0)
        throw new ApiError(
          "COMMAND_FAILED",
          `Cannot check theme package ${item.name}: ${result.stderr.trim()}`,
        );
    }
    return missing;
  }

  /** Install only missing prerequisites before publication or activation; reads never install. */
  async install({ context, packages = [] }: { context: ThemeContext; packages?: ThemePackage[] }) {
    const missing = await this.missing({ context, packages });
    const official = missing.filter((item) => item.source === "pacman").map((item) => item.name);
    const aur = missing.filter((item) => item.source === "aur");
    const tools = [...(official.length ? ["sudo"] : []), ...(aur.length ? ["yay"] : [])];
    for (const tool of tools)
      if (!Bun.which(tool, { PATH: context.env.PATH }))
        throw new ApiError(
          "INVALID_ENVIRONMENT",
          `Missing theme packages require ${tool}; install it first`,
        );
    if (official.length)
      await themeCommand.run({
        context,
        args: ["sudo", "pacman", "-S", "--needed", "--noconfirm", "--", ...official],
      });
    for (const item of aur)
      await themeCommand.run({
        context,
        args: ["yay", "-S", "--needed", "--noconfirm", "--", item.name],
      });
  }
}

export const themePackages = new ThemePackages();
