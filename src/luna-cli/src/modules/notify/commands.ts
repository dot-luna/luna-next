import { Luna, type NotifyOptions } from "@luna/api";
import type { Command } from "commander";
import type { Output } from "@/lib/output.ts";

export function addNotifyCommands(program: Command, output: Output) {
  const group = program
    .command("notify")
    .description("Show application notification toasts")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--config <path>", "Notification JSONC file");
  const options = (): NotifyOptions => ({
    repository: group.opts<{ installDir?: string }>().installDir,
    configFile: group.opts<{ config?: string }>().config,
  });
  const run = async (action: "start" | "stop" | "restart" | "status" | "focus" | "dismiss") => {
    output.response(
      await Luna.notify[action](options()),
      (state) => `Notifications: ${state.running ? "running" : "stopped"}`,
    );
  };
  group
    .command("get [key]")
    .action(async (key?: string) => output.response(await Luna.notify.get(key, options())));
  group
    .command("get-config-file")
    .action(async () => output.response(await Luna.notify.getConfigFile(options())));
  group.action(() => run("status"));
  for (const action of ["start", "stop", "restart", "status", "focus", "dismiss"] as const)
    group.command(action).action(() => run(action));
}
