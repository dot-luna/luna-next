import { join } from "pathe";
import { z } from "zod";
import { ApiError } from "../../lib/response.ts";
import type { InstallContext } from "./command.ts";

export const packageRecipeSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9@._+/-]*$/u),
    source: z.enum(["pacman", "aur", "mise"]),
    version: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/u)
      .optional(),
    purpose: z.string().optional(),
    url: z.string().nullable().optional(),
  })
  .strict();

const stages = z
  .object({
    before_cli: z.array(packageRecipeSchema),
    after_cli: z.array(packageRecipeSchema),
    later: z.array(packageRecipeSchema),
  })
  .strict();

export type PackageRecipe = z.infer<typeof packageRecipeSchema>;

async function readJsonc<T>(path: string, schema: z.ZodType<T>): Promise<T> {
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

/** Only active package stages are executed; AUR packages require an existing yay. */
export async function readPackages(context: InstallContext, checkTools = true) {
  const packages = await readJsonc(join(context.repository, "installs/packages.jsonc"), stages);
  const mise = await readJsonc(
    join(context.repository, "installs/packages.mise.jsonc"),
    z.array(packageRecipeSchema.extend({ source: z.literal("mise") })),
  );
  const names = new Set<string>();
  for (const item of [...packages.before_cli, ...packages.after_cli, ...packages.later, ...mise]) {
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

export async function installPackages(context: InstallContext, packages: PackageRecipe[]) {
  // Install system prerequisites together before recipes that depend on mise or yay.
  const pacman = packages.filter((item) => item.source === "pacman").map((item) => item.name);
  if (pacman.length)
    await context.execute(["sudo", "pacman", "-S", "--needed", "--noconfirm", "--", ...pacman]);
  for (const item of packages.filter((item) => item.source !== "pacman")) {
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
}
