import { Luna, type BarOptions } from "@luna/api";
import type { Command } from "commander";
import type { createOutput } from "../lib/output.ts";

export function addBarCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  setExitCode: (code: number) => void,
) {
  const group = program
    .command("bar")
    .description("Control Luna's workspace bar")
    .option("--install-dir <path>", "Luna source checkout");
  const options = (): BarOptions => ({
    repository: group.opts<{ installDir?: string }>().installDir,
  });
  const run = async (action: keyof typeof Luna.bar) => {
    setExitCode(
      output.response(
        await Luna.bar[action](options()),
        (state) => `Bar: ${state.running ? "running" : "stopped"}`,
      ),
    );
  };
  group.action(() => run("start"));
  for (const action of ["start", "stop", "restart", "status", "focus"] as const)
    group.command(action).action(() => run(action));
}
