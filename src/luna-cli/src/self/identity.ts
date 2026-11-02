import type { GitIdentity } from "@luna/api";
import { promptForm } from "../lib/prompts.ts";

/** Ask only for identity fields missing from global Git configuration. */
export async function requestGitIdentity(current: Partial<GitIdentity>): Promise<GitIdentity> {
  return (
    (await promptForm(async (ask) => ({
      name: current.name || (await ask("Git user name: ")),
      email: current.email || (await ask("Git email: ")),
    }))) ?? { name: current.name ?? "", email: current.email ?? "" }
  );
}
