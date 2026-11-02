import { Luna } from "@luna/api";
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
    .option("--force", "Rerun installation hooks and rebuild Git apps")
    .action(async (names: string[], options: { installDir?: string; force?: boolean }) => {
      const response = await Luna.apps.install(names, {
        repository: options.installDir,
        force: options.force,
        onProgress: output.progress,
      });
      setExitCode(
        output.response(response, (apps) => `Installed and configured: ${apps.join(", ")}`),
      );
    });
  program
    .command("configure [names...]")
    .aliases(["config", "confi"])
    .description("Apply indexed app defaults without installing packages")
    .option("--install-dir <path>", "Luna source checkout")
    .action(async (names: string[], options: { installDir?: string }) => {
      const response = await Luna.apps.configure(names, {
        repository: options.installDir,
        onProgress: output.progress,
      });
      setExitCode(output.response(response, (apps) => `Configured: ${apps.join(", ")}`));
    });
}
