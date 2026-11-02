import { Luna } from "@luna/api";
import { installReport } from "../lib/install-report.ts";
import type { Command } from "commander";
import type { createOutput } from "../lib/output.ts";

export function addAppCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  setExitCode: (code: number) => void,
) {
  program
    .command("install [names...]")
    .description("Install and configure indexed apps in catalog order")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--skip-failed", "Continue after app failures and report retries")
    .option("--no-close-apps", "Do not automatically close apps")
    .option("--force", "Rerun installation hooks and rebuild Git apps")
    .action(
      async (
        names: string[],
        options: {
          installDir?: string;
          force?: boolean;
          skipFailed?: boolean;
          closeApps?: boolean;
        },
      ) => {
        const response = await Luna.apps.install(names, {
          repository: options.installDir,
          force: options.force,
          skipFailed: options.skipFailed,
          closeApps: options.closeApps,
          onProgress: output.progress,
        });
        const code = output.response(response, (data) =>
          installReport(data.completed, data.installed, data.failed, data.logDirectory),
        );
        setExitCode(response.succes && !response.data.completed ? 1 : code);
      },
    );
  program
    .command("configure [names...]")
    .aliases(["config", "confi"])
    .description("Apply indexed app defaults without installing packages")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--no-close-apps", "Do not automatically close apps")
    .action(async (names: string[], options: { installDir?: string; closeApps?: boolean }) => {
      const response = await Luna.apps.configure(names, {
        closeApps: options.closeApps,
        repository: options.installDir,
        onProgress: output.progress,
      });
      setExitCode(output.response(response, (apps) => `Configured: ${apps.join(", ")}`));
    });
}
