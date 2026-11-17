import { Luna, type InstallFailure } from "@luna/api";
import { installReport } from "@/lib/install-report.ts";
import type { Command } from "commander";
import type { createOutput } from "@/lib/output.ts";

/**
 * Handle arguments and output; app operations stay in Luna API.
 * With --skip-failed, a successful response can contain failed apps. Those batches still exit 1.
 */
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

  program
    .command("update [names...]")
    .description("Update installed catalog apps")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--skip-failed", "Continue after app failures and report retries")
    .option("--no-close-apps", "Do not automatically close apps")
    .option("--force", "Rebuild unchanged Git apps")
    .action(
      async (
        names: string[],
        options: {
          installDir?: string;
          skipFailed?: boolean;
          closeApps?: boolean;
          force?: boolean;
        },
      ) => {
        const response = await Luna.apps.update(names, {
          repository: options.installDir,
          skipFailed: options.skipFailed,
          closeApps: options.closeApps,
          force: options.force,
          onProgress: output.progress,
        });
        const code = output.response(response, (data) =>
          formatOperation({
            label: "Updated",
            names: data.updated,
            failed: data.failed,
            logDirectory: data.logDirectory,
          }),
        );
        setExitCode(response.succes && !response.data.completed ? 1 : code);
      },
    );

  program
    .command("uninstall <names...>")
    .description("Uninstall named apps; keep personal settings and data")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--skip-failed", "Continue after app failures and report retries")
    .option("--no-close-apps", "Do not automatically close apps")
    .option("--purge", "Also remove declared settings/data, even after uninstall")
    .action(
      async (
        names: string[],
        options: {
          installDir?: string;
          skipFailed?: boolean;
          closeApps?: boolean;
          purge?: boolean;
        },
      ) => {
        const response = await Luna.apps.uninstall(names, {
          repository: options.installDir,
          skipFailed: options.skipFailed,
          closeApps: options.closeApps,
          purge: options.purge,
          onProgress: output.progress,
        });
        const code = output.response(response, (data) =>
          formatOperation({
            label: "Uninstalled",
            names: data.uninstalled,
            failed: data.failed,
            logDirectory: data.logDirectory,
          }),
        );
        setExitCode(response.succes && !response.data.completed ? 1 : code);
      },
    );
}

/** Human reports show completed apps and actionable retries; JSON retains the API response. */
function formatOperation({
  label,
  names,
  failed,
  logDirectory,
}: {
  label: string;
  names: string[];
  failed: InstallFailure[];
  logDirectory: string;
}) {
  const lines = [names.length ? `${label}: ${names.join(", ")}` : "No apps changed."];
  for (const failure of failed) {
    lines.push(`${failure.app} failed: ${failure.error.slice(0, 1800)}`);
    lines.push(`Retry: ${failure.retry}`);
  }
  lines.push(`Logs: ${logDirectory}`);
  return lines.join("\n");
}
