import { z } from "zod";

/** One package from installs/*.jsonc or an app manifest's deps; apps extend it for their own entry. */
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

export type PackageRecipe = z.infer<typeof packageRecipeSchema>;

/** installs/packages.jsonc, in installation order. */
export const packageStagesSchema = z
  .object({
    before_cli: z.array(packageRecipeSchema),
    after_cli: z.array(packageRecipeSchema),
    later: z.array(packageRecipeSchema),
  })
  .strict();

/** installs/packages.mise.jsonc. */
export const misePackagesSchema = z.array(
  packageRecipeSchema.extend({ source: z.literal("mise") }),
);

/** Release versions are plain x.y.z without leading zeros. */
export const versionSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);

export const checkoutPackageSchema = z.object({ version: versionSchema });

/** The last applied release, bound to one checkout so another checkout cannot reuse it. */
export const migrationStateSchema = z
  .object({ repository: z.string(), version: versionSchema })
  .strict();
