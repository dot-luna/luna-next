import { Luna, type StayAwakeAction } from "@luna/api";
import { Argument, type Command } from "commander";
import type { createOutput } from "../lib/output.ts";

export function addToggleCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  setExitCode: (code: number) => void,
) {
  const group = program.command("toggle").description("Toggle desktop modes");
  group.action(() => group.outputHelp());

  const awake = group
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
