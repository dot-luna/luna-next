import { z } from "zod";

export const hookNames = ["before_install", "after_install", "before_uninstall", "after_uninstall",
  "before_build", "build", "after_build", "before_configure", "after_configure"] as const;
export const runtimeActions = ["start", "stop", "reload", "restart", "status"] as const;

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u);
const path = z.string().min(1).regex(/^[^\x00-\x1f\x7f]+$/u);
const command = z.array(z.string().min(1).regex(/^[^\x00]+$/u)).min(1);
const version = z.string().regex(/^[^-\x00-\x1f\x7f][^\x00-\x1f\x7f]*$/u);
const integration = z.discriminatedUnion("dest_mode", [
  z.strictObject({ dest: z.array(path).min(1), dest_mode: z.literal("merge") }),
  z.strictObject({
    dest: z.array(path).min(1), dest_mode: z.literal("include"),
    include: z.string().regex(/^[^\r\n]*\{\{path\}\}[^\r\n]*$/u)
      .refine(value => value.split("{{path}}").length === 2, "Expected exactly one {{path}} placeholder"),
  }),
]);

export const appSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9@][A-Za-z0-9@._+:/-]*$/u),
  source: z.enum(["pacman", "aur", "mise", "git", "local"]),
  alias: z.array(id).refine(values => new Set(values).size === values.length, "Duplicate aliases").optional(),
  url: version.optional(),
  version: version.optional(),
  git_include_prereleases: z.boolean().optional(),
  git_release_tag_pattern: path.optional(),
  exports: z.array(z.strictObject({
    source: path, target: path,
    exclude: z.array(path).optional(),
    user_config: integration.optional(),
  })).optional(),
  hooks: z.partialRecord(z.enum(hookNames), z.array(path)).optional(),
  /** Commands control a service and return. status uses 0=running, 3=stopped. */
  runtime: z.partialRecord(z.enum(runtimeActions), command).optional(),
}).superRefine((app, context) => {
  if ((app.source === "git" || app.source === "local") && !app.url) {
    context.addIssue({ code: "custom", path: ["url"], message: `${app.source} apps require url` });
  }
  if ((app.source === "pacman" || app.source === "aur") && app.version) {
    context.addIssue({ code: "custom", path: ["version"], message: "Pacman and AUR version pinning is unsupported" });
  }
});

export const catalogSchema = z.strictObject({
  packages: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*\/app\.conf$/u))
    .refine(values => new Set(values).size === values.length, "Duplicate catalog entries"),
});

/** Zod is the single definition of manifest fields and their TypeScript types. */
export type AppManifest = z.infer<typeof appSchema>;
export type AppExport = NonNullable<AppManifest["exports"]>[number];
