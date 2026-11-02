import { Luna } from "@luna/api";
import type { Command } from "commander";
import type { createOutput } from "../lib/output.ts";
import { installReport } from "../lib/install-report.ts";
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

export function addSelfCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  json: boolean,
  setExitCode: (value: number) => void,
) {
  const self = program.command("self").description("Install or update Luna");
  const install = self
    .command("install")
    .description("Install Luna, Git configuration, themes, apps and web apps")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--ref <ref>", "Git branch, tag, or latest (remote default branch)", "latest")
    .option("--from-bootstrap", "install.sh already updated the checkout and installed the CLI")
    .option("--skip-failed", "Continue after app failures and report retries at the end")
    .option("--no-close-apps", "Do not automatically close apps for configuration")
    .option("--git-name <name>", "Set the global Git user name")
    .option("--git-email <email>", "Set the global Git email");
  install.action(async (options: SelfOptions) => {
    const response = await Luna.self.install({
      repository: options.installDir,
      ref: options.ref,
      fromBootstrap: options.fromBootstrap,
      skipFailed: options.skipFailed,
      closeApps: options.closeApps,
      git: { name: options.gitName, email: options.gitEmail },
      requestGitIdentity: json ? undefined : requestGitIdentity,
      onProgress: output.progress,
    });
    const code = output.response(response, (data) =>
      installReport(data.completed, data.installedApps, data.failed, data.logDirectory),
    );
    setExitCode(response.succes && !response.data.completed ? 1 : code);
  });
  self
    .command("update")
    .description("Update the Luna checkout and rebuild the CLI")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--ref <ref>", "Git branch, tag, or latest (remote default branch)", "latest")
    .action(async (options: SelfOptions) => {
      const response = await Luna.self.update({
        repository: options.installDir,
        ref: options.ref,
        onProgress: output.progress,
      });
      setExitCode(output.response(response, (data) => `Luna CLI updated: ${data.executable}`));
    });
}
