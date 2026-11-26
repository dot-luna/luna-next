import { Luna, type PolkitOptions } from "@luna/api";
import type { Command } from "commander";
import type { Output } from "@/lib/output.ts";

export function addPolkitCommands(program: Command, output: Output) {
  const group = program
    .command("polkit")
    .description("Control desktop authentication prompts")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--config <path>", "Polkit JSONC file");
  const options = (): PolkitOptions => ({
    repository: group.opts<{ installDir?: string }>().installDir,
    configFile: group.opts<{ config?: string }>().config,
  });
  const run = async (action: "start" | "stop" | "restart" | "status") => {
    output.response(await Luna.polkit[action](options()), (state) => `Polkit: ${state.status}`);
  };
  group
    .command("get [key]")
    .action(async (key?: string) => output.response(await Luna.polkit.get(key, options())));
  group
    .command("get-config-file")
    .action(async () => output.response(await Luna.polkit.getConfigFile(options())));
  group.action(() => run("status"));
  for (const action of ["start", "stop", "restart", "status"] as const)
    group.command(action).action(() => run(action));
}
