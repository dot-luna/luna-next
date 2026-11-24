import { Luna, type BarOptions } from "@luna/api";
import type { Command } from "commander";
import type { Output } from "@/lib/output.ts";

const actions = ["start", "stop", "restart", "status", "focus", "toggle"] as const;

export function addBarCommands(program: Command, output: Output) {
  const group = program
    .command("bar")
    .description("Control Luna's workspace bar")
    .option("--install-dir <path>", "Luna source checkout");
  const options = (): BarOptions => ({
    repository: group.opts<{ installDir?: string }>().installDir,
  });
  const run = async (action: (typeof actions)[number]) => {
    output.response(
      await Luna.bar[action](options()),
      (state) => `Bar: ${state.running ? "running" : "stopped"}`,
    );
  };
  group.action(() => run("start"));
  for (const action of actions) group.command(action).action(() => run(action));
}
