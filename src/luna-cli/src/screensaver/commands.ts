import { Luna, type ApiResponse, type ScreensaverOptions } from "@luna/api";
import { InvalidArgumentError, type Command } from "commander";
import type { createOutput } from "../lib/output.ts";

function render(value: unknown): string {
  return value === null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function seconds(value: string): number {
  const duration = Number(value);
  if (!value.trim() || !Number.isFinite(duration))
    throw new InvalidArgumentError("Expected a duration in seconds");
  return duration;
}

export function addScreensaverCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  setExitCode: (code: number) => void,
) {
  const group = program
    .command("screensaver")
    .description("Show Luna's screensaver and configure idle activation")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--config <path>", "Screensaver JSONC file")
    .option("--launcher <path>", "Luna executable for idle activation");
  const options = (): ScreensaverOptions => {
    const flags = group.opts<{ installDir?: string; config?: string; launcher?: string }>();
    return {
      repository: flags.installDir,
      configFile: flags.config,
      launcher: flags.launcher,
    };
  };
  const done = <T>(response: ApiResponse<T>, format: (value: T) => string = render) =>
    setExitCode(output.response(response, format));
  const run = async (
    action: "start" | "show" | "showIdle" | "hide" | "stop" | "restart" | "reload" | "status",
  ) => done(await Luna.screensaver[action](options()), (state) => `Screensaver: ${state.status}`);

  group.action(() => run("show"));
  group.command("show-idle", { hidden: true }).action(() => run("showIdle"));
  group
    .command("show")
    .alias("open")
    .action(() => run("show"));
  for (const action of ["start", "hide", "stop", "restart", "reload", "status"] as const)
    group.command(action).action(() => run(action));
  group
    .command("get [key]")
    .description("Read a setting or the saved settings")
    .action(async (key?: string) => done(await Luna.screensaver.get(key, options())));
  group
    .command("get-config-file")
    .description("Locate the screensaver JSONC file")
    .action(async () => done(await Luna.screensaver.getConfigFile(options())));
  group
    .command("set-idle")
    .description("Set idle activation in seconds; 0 disables it")
    .argument("<seconds>", "Idle duration in seconds", seconds)
    .action(async (idle_seconds: number) =>
      done(
        await Luna.screensaver.configure({ idle_seconds }, options()),
        () => "Screensaver updated.",
      ),
    );
}
