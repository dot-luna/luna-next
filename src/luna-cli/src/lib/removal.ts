import type { ApiResponse } from "@luna/api";
import { createInterface } from "node:readline/promises";
import type { Output } from "./output.ts";

interface RemovalOptions {
  output: Output;
  /** Capitalized item kind used in messages, such as `Theme`. */
  label: string;
  flags: { dryRun?: boolean; yes?: boolean };
  /** Run the API removal; `dryRun: true` only lists the paths it would delete. */
  remove: (dryRun?: boolean) => Promise<ApiResponse<string[]>>;
}

/**
 * Remove installed items, asking for confirmation unless `--dry-run` or `--yes` is given.
 * A dry run happens first so invalid names fail before any prompt. JSON mode and
 * non-interactive stdin cannot confirm, so they fail with INPUT_REQUIRED.
 */
export async function confirmRemoval({ output, label, flags, remove }: RemovalOptions) {
  const paths = (removed: string[]) => removed.join("\n");
  if (flags.dryRun || flags.yes) return output.response(await remove(flags.dryRun), paths);
  const plan = await remove(true);
  if (!plan.succes) return output.response(plan);
  if (output.json || !process.stdin.isTTY)
    return output.response({
      succes: false,
      err: "INPUT_REQUIRED",
      errMessage: `${label} removal requires --yes or --dry-run without an interactive terminal`,
    });
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await prompt.question(
      `${plan.data.join("\n")}\nRemove ${plan.data.length} ${label.toLowerCase()}(s)? [y/N] `,
    );
    if (!/^(y|yes)$/iu.test(answer.trim()))
      return output.response({ succes: true, data: [] }, () => "");
  } finally {
    prompt.close();
  }
  return output.response(await remove(), paths);
}
