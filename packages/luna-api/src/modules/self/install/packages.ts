import { join } from "pathe";
import type { z } from "zod";
import { ApiError } from "@/lib/response.ts";
import type { InstallContext } from "./command.ts";
import { miseShell } from "./mise.ts";
import {
  misePackagesSchema,
  packageStagesSchema,
  type PackageRecipe,
} from "@/modules/self/schema.ts";

class PackageRecipes {
  /**
   * Read installs/packages.jsonc and installs/packages.mise.jsonc, rejecting duplicate names.
   * checkTools also requires yay when an early stage declares an AUR package.
   */
  async read({ context, checkTools = true }: { context: InstallContext; checkTools?: boolean }) {
    const packages = await this._readList({
      path: join(context.repository, "installs/packages.jsonc"),
      schema: packageStagesSchema,
    });
    const mise = await this._readList({
      path: join(context.repository, "installs/packages.mise.jsonc"),
      schema: misePackagesSchema,
    });
    const names = new Set<string>();
    for (const item of [
      ...packages.before_cli,
      ...packages.after_cli,
      ...packages.later,
      ...mise,
    ]) {
      if (names.has(item.name))
        throw new ApiError("INVALID_METADATA", `Duplicate package: ${item.name}`);
      names.add(item.name);
    }
    if (
      checkTools &&
      [...packages.before_cli, ...packages.after_cli].some((item) => item.source === "aur") &&
      !Bun.which("yay", { PATH: context.env.PATH })
    ) {
      throw new ApiError(
        "INVALID_ENVIRONMENT",
        "An early AUR package requires an already installed yay",
      );
    }
    return { ...packages, mise };
  }

  /** Install pacman packages in one transaction, then AUR and mise packages in order. */
  async install({ context, recipes }: { context: InstallContext; recipes: PackageRecipe[] }) {
    // Install system prerequisites together before recipes that depend on mise or yay.
    const pacman = recipes.filter((item) => item.source === "pacman").map((item) => item.name);
    if (pacman.length)
      await context.execute(["sudo", "pacman", "-S", "--needed", "--noconfirm", "--", ...pacman]);
    for (const item of recipes.filter((item) => item.source !== "pacman")) {
      if (item.source === "aur") {
        await context.execute(["yay", "-S", "--needed", "--noconfirm", "--", item.name]);
      } else {
        await context.execute([
          "mise",
          "--cd",
          context.home,
          "use",
          "--global",
          "--yes",
          `${item.name}@${item.version ?? "latest"}`,
        ]);
      }
    }
    if (recipes.some((item) => item.source === "mise")) await miseShell.configure(context);
  }

  private async _readList<T>({ path, schema }: { path: string; schema: z.ZodType<T> }): Promise<T> {
    const text = await Bun.file(path).text();
    try {
      return schema.parse(Bun.JSONC.parse(text));
    } catch (error) {
      throw new ApiError(
        "INVALID_METADATA",
        `Invalid package list ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const packageRecipes = new PackageRecipes();
