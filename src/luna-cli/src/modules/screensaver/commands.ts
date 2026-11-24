import { Luna, type ScreensaverOptions } from "@luna/api";
import type { Command } from "commander";
import { duration } from "@/lib/arguments.ts";
import type { Output } from "@/lib/output.ts";

export function addScreensaverCommands(program: Command, output: Output) {
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
  const run = async (
    action: "start" | "show" | "showIdle" | "hide" | "stop" | "restart" | "reload" | "status",
  ) =>
    output.response(
      await Luna.screensaver[action](options()),
      (state) => `Screensaver: ${state.status}`,
    );

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
    .action(async (key?: string) => output.response(await Luna.screensaver.get(key, options())));
  group
    .command("get-config-file")
    .description("Locate the screensaver JSONC file")
    .action(async () => output.response(await Luna.screensaver.getConfigFile(options())));
  group
    .command("set-idle")
    .description("Set idle activation in seconds; 0 disables it")
    .argument("<seconds>", "Idle duration in seconds", duration("seconds"))
    .action(async (idle_seconds: number) =>
      output.response(
        await Luna.screensaver.configure({ idle_seconds }, options()),
        () => "Screensaver updated.",
      ),
    );
}
