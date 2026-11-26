import { createInterface } from "node:readline/promises";
import { Luna, type ThemeOptions, type ThemeInfo } from "@luna/api";
import type { Output } from "@/lib/output.ts";

export function describeTheme(plan: ThemeInfo) {
  return [
    `Theme: ${plan.suggestedName}`,
    `Fonts: ${plan.fonts.ui}, ${plan.fonts.mono}`,
    ...plan.files.map((file) => `File: ${file.path}`),
    ...plan.wallpapers.map((path) => `Wallpaper: ${path}`),
    ...plan.packages.map(
      (item) =>
        `Package: ${item.name} (${item.source}${item.installed ? ", installed" : ", will install"})`,
    ),
  ].join("\n");
}

/** Keep interactive naming/approval in the CLI; the API owns the same preview and validation. */
export async function installTheme({
  source,
  options,
  flags,
  output,
}: {
  source: string;
  options: ThemeOptions;
  flags: { name?: string; force?: boolean; dryRun?: boolean; yes?: boolean };
  output: Output;
}) {
  const preview = await Luna.theme.info(source, options);
  if (!preview.succes) return output.response(preview);
  if (flags.dryRun) return output.response(preview, describeTheme);
  const plan = preview.data;
  let name = flags.name;
  const interactive = !output.json && process.stdin.isTTY;
  if ((!name && plan.needsName) || (plan.remote && !flags.yes)) {
    if (!interactive)
      return output.response({
        succes: false,
        err: "INPUT_REQUIRED",
        errMessage: `${!name && plan.needsName ? "Choose a theme name with --name. " : ""}${plan.remote && !flags.yes ? "Remote installation requires --yes; use --dry-run to preview files and packages." : ""}`,
      });
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    try {
      if (!name && plan.needsName)
        name =
          (await prompt.question(`Theme name [${plan.suggestedName}]: `)).trim() ||
          plan.suggestedName;
      if (plan.remote && !flags.yes) {
        const answer = await prompt.question(
          `${describeTheme(plan)}\nDownload and install? [y/N] `,
        );
        if (!/^(y|yes)$/iu.test(answer.trim()))
          return output.response({ succes: true, data: null });
      }
    } finally {
      prompt.close();
    }
  }
  return output.response(
    await Luna.theme.install(source, {
      ...options,
      name,
      force: flags.force,
      fingerprint: plan.fingerprint,
    }),
  );
}
