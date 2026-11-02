import { Luna, type MenuOptions } from "@luna/api";
import type { Command } from "commander";
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
  const run = async (action: keyof typeof Luna.menu) => {
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
}
