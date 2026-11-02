import { isAbsolute } from "pathe";
import { z } from "zod";
import { packageRecipeSchema } from "../self/install/packages.ts";

// Commands and paths are displayed or passed to native tools; control bytes are invalid.
// oxlint-disable-next-line no-control-regex
const printable = /^[^\x00-\x1f\x7f]+$/u;
export const appNameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/u);
export const relativePathSchema = z
  .string()
  .min(1)
  .regex(printable)
  .refine(
    (value) => !isAbsolute(value) && !value.split("/").includes("..") && value !== ".",
    "Use a path inside the declared directory",
  );
const hooks = z.array(relativePathSchema);
export const appSchema = packageRecipeSchema
  .extend({
    name: appNameSchema,
    source: z.enum(["pacman", "aur", "mise", "git", "local"]),
    version: z.string().min(1).regex(printable).nullable().optional(),
    url: z.string().min(1).regex(printable).nullable().optional(),
    alias: z.array(appNameSchema).optional(),
    alias_command: z.array(z.string().min(1).regex(printable)).min(1).optional(),
    processes: z
      .array(
        z
          .string()
          .min(1)
          .regex(printable)
          .refine((value) => !value.includes("/")),
      )
      .optional(),
    deps: z.array(packageRecipeSchema).optional(),
    git_include_prereleases: z.boolean().optional(),
    git_release_tag_pattern: z.string().min(1).regex(printable).optional(),
    exports: z
      .array(
        z.strictObject({
          source: relativePathSchema,
          target: relativePathSchema,
          exclude: z.array(relativePathSchema).optional(),
          user_config: z
            .strictObject({
              dest: z.array(z.string().min(1).regex(printable)).min(1),
              dest_mode: z.enum(["merge", "include"]),
            })
            .optional(),
        }),
      )
      .optional(),
    hooks: z
      .strictObject({
        before_install: hooks.optional(),
        after_install: hooks.optional(),
        before_build: hooks.optional(),
        build: hooks.optional(),
        after_build: hooks.optional(),
        before_configure: hooks.optional(),
        after_configure: hooks.optional(),
      })
      .optional(),
  })
  .superRefine((app, context) => {
    if (app.source === "git" && !app.url)
      context.addIssue({ code: "custom", message: "Git apps require a URL", path: ["url"] });
  });
export const appsIndexSchema = z.strictObject({ packages: z.array(relativePathSchema) });
export type AppManifest = z.infer<typeof appSchema>;
export type HookStage = keyof NonNullable<AppManifest["hooks"]>;
