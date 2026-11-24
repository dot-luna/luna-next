import { Luna } from "@luna/api";
import type { Command } from "commander";
import { installReport } from "@/lib/install-report.ts";
import type { Output } from "@/lib/output.ts";
import { requestGitIdentity } from "./identity.ts";

interface SelfOptions {
  installDir?: string;
  ref: string;
  fromBootstrap?: boolean;
  gitName?: string;
  gitEmail?: string;
  skipFailed?: boolean;
  closeApps?: boolean;
}

export function addSelfCommands(program: Command, output: Output) {
  const self = program.command("self").description("Install or update Luna");
  self
    .command("install")
    .description("Install Luna, Git configuration, themes, apps and web apps")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--ref <ref>", "Git branch, tag, or latest (remote default branch)", "latest")
    .option("--from-bootstrap", "install.sh already updated the checkout and installed the CLI")
    .option("--skip-failed", "Continue after app failures and report retries at the end")
    .option("--no-close-apps", "Do not automatically close apps for configuration")
    .option("--git-name <name>", "Set the global Git user name")
    .option("--git-email <email>", "Set the global Git email")
    .action(async (options: SelfOptions) => {
      const response = await Luna.self.install({
        repository: options.installDir,
        ref: options.ref,
        fromBootstrap: options.fromBootstrap,
        skipFailed: options.skipFailed,
        closeApps: options.closeApps,
        git: { name: options.gitName, email: options.gitEmail },
        // JSON mode never prompts; missing identity values must come from flags or Git config.
        requestGitIdentity: output.json ? undefined : requestGitIdentity,
        onProgress: output.progress,
      });
      output.report(response, (data) =>
        installReport(data.completed, data.installedApps, data.failed, data.logDirectory),
      );
    });
  self
    .command("update")
    .description("Update Luna and apply pending release migrations")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--ref <ref>", "Git branch, tag, or latest (remote default branch)", "latest")
    .action(async (options: SelfOptions) => {
      const response = await Luna.self.update({
        repository: options.installDir,
        ref: options.ref,
        onProgress: output.progress,
      });
      output.response(response, (data) => `Luna updated: ${data.executable}`);
    });
}
