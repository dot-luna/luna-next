import { Luna, type DefaultEntry, type DefaultsOptions } from "@luna/api";
import type { Command } from "commander";
import type { createOutput } from "../lib/output.ts";

function renderEntry(entry: DefaultEntry): string {
  const values = [...new Set(Object.values(entry.current))];
  const current = values.length > 1 ? "mixed" : (values[0] ?? "unset");
  const heading = `${entry.key}: configured ${entry.value}${entry.available ? "" : " (unavailable)"}; current ${current}`;
  return values.length > 1
    ? `${heading}\n${Object.entries(entry.current)
        .map(([key, value]) => `  ${key}: ${value ?? "unset"}`)
        .join("\n")}`
    : heading;
}

function renderApplied(result: { applied: Record<string, string> }): string {
  return (
    Object.entries(result.applied)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n") || "No defaults changed."
  );
}

export function addDefaultsCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  setExitCode: (code: number) => void,
) {
  const group = program
    .command("defaults")
    .description("List, set, and restore system application defaults")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--config <path>", "Defaults JSONC file");
  const options = (): DefaultsOptions => {
    const flags = group.opts<{ installDir?: string; config?: string }>();
    return {
      repository: flags.installDir,
      configFile: flags.config,
      onProgress: output.progress,
    };
  };
  group
    .command("list")
    .description("Show configured choices, active defaults, and application availability")
    .action(async () =>
      setExitCode(
        output.response(await Luna.defaults.list(options()), (entries) =>
          entries.map(renderEntry).join("\n"),
        ),
      ),
    );
  group
    .command("set <key> <application>")
    .description("Change an active default without editing the defaults JSONC")
    .action(async (key: string, application: string) =>
      setExitCode(
        output.response(await Luna.defaults.set(key, application, options()), renderApplied),
      ),
    );
  group
    .command("reset [keys...]")
    .description("Reapply configured defaults; omit keys to restore all")
    .action(async (keys: string[]) =>
      setExitCode(output.response(await Luna.defaults.reset(keys, options()), renderApplied)),
    );
}
