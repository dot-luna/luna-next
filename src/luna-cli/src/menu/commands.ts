import { Luna, type MenuOptions, type StayAwakeAction } from "@luna/api";
import { Argument, type Command } from "commander";
import type { createOutput } from "../lib/output.ts";

export function addMenuCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  setExitCode: (code: number) => void,
) {
  const group = program
    .command("menu")
    .description("Open Luna's menu and installed applications")
    .option("--install-dir <path>", "Luna source checkout");
  const options = (): MenuOptions => ({
    repository: group.opts<{ installDir?: string }>().installDir,
  });
  const run = async (action: Exclude<keyof typeof Luna.menu, "stayAwake">) => {
    setExitCode(
      output.response(
        await Luna.menu[action](options()),
        (state) => `Menu: ${state.running ? "running" : "stopped"}`,
      ),
    );
  };
  group.action(() => run("show"));
  for (const action of ["show", "system", "hide", "toggle", "start", "stop", "status"] as const)
    group.command(action).action(() => run(action));

  const awake = program
    .command("stay-awake")
    .description("Toggle automatic idle inhibition until the menu stops")
    .addArgument(
      new Argument("[action]", "Stay awake control")
        .choices(["on", "off", "toggle", "status"])
        .default("toggle"),
    )
    .option("--install-dir <path>", "Luna source checkout")
    .action(async (action: StayAwakeAction) => {
      setExitCode(
        output.response(
          await Luna.menu.stayAwake(action, {
            repository: awake.opts<{ installDir?: string }>().installDir,
          }),
          (state) => `Stay awake: ${state.enabled ? "on" : "off"}`,
        ),
      );
    });
}
