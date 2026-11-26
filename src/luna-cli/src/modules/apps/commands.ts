import { Luna, type InstallFailure } from "@luna/api";
import type { Command } from "commander";
import { installReport } from "@/lib/install-report.ts";
import type { Output } from "@/lib/output.ts";

/** Flags parsed by the app commands; each command declares only the ones it accepts. */
interface AppFlags {
  installDir?: string;
  skipFailed?: boolean;
  closeApps?: boolean;
  force?: boolean;
  purge?: boolean;
}

/**
 * Handle arguments and output; app operations stay in Luna API.
 * With --skip-failed, a successful response can contain failed apps. Those batches still exit 1.
 */
export function addAppCommands(program: Command, output: Output) {
  program
    .command("install [names...]")
    .description("Install and configure indexed apps in catalog order")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--skip-failed", "Continue after app failures and report retries")
    .option("--no-close-apps", "Do not automatically close apps")
    .option("--force", "Rerun installation hooks and rebuild Git apps")
    .action(async (names: string[], options: AppFlags) => {
      const response = await Luna.apps.install(names, {
        repository: options.installDir,
        force: options.force,
        skipFailed: options.skipFailed,
        closeApps: options.closeApps,
        onProgress: output.progress,
      });
      output.report(response, (data) =>
        installReport(data.completed, data.installed, data.failed, data.logDirectory),
      );
    });

  program
    .command("configure [names...]")
    .aliases(["config", "confi"])
    .description("Apply indexed app defaults without installing packages")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--no-close-apps", "Do not automatically close apps")
    .action(async (names: string[], options: AppFlags) => {
      const response = await Luna.apps.configure(names, {
        closeApps: options.closeApps,
        repository: options.installDir,
        onProgress: output.progress,
      });
      output.response(response, (apps) => `Configured: ${apps.join(", ")}`);
    });

  program
    .command("update [names...]")
    .description("Update installed catalog apps")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--skip-failed", "Continue after app failures and report retries")
    .option("--no-close-apps", "Do not automatically close apps")
    .option("--force", "Rebuild unchanged Git apps")
    .action(async (names: string[], options: AppFlags) => {
      const response = await Luna.apps.update(names, {
        repository: options.installDir,
        skipFailed: options.skipFailed,
        closeApps: options.closeApps,
        force: options.force,
        onProgress: output.progress,
      });
      output.report(response, (data) =>
        formatOperation({
          label: "Updated",
          names: data.updated,
          failed: data.failed,
          logDirectory: data.logDirectory,
        }),
      );
    });

  program
    .command("uninstall <names...>")
    .description("Uninstall named apps; keep personal settings and data")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--skip-failed", "Continue after app failures and report retries")
    .option("--no-close-apps", "Do not automatically close apps")
    .option("--purge", "Also remove declared settings/data, even after uninstall")
    .action(async (names: string[], options: AppFlags) => {
      const response = await Luna.apps.uninstall(names, {
        repository: options.installDir,
        skipFailed: options.skipFailed,
        closeApps: options.closeApps,
        purge: options.purge,
        onProgress: output.progress,
      });
      output.report(response, (data) =>
        formatOperation({
          label: "Uninstalled",
          names: data.uninstalled,
          failed: data.failed,
          logDirectory: data.logDirectory,
        }),
      );
    });
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
