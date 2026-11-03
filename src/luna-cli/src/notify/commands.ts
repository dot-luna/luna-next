import { Luna, type NotifyOptions } from "@luna/api";
import type { Command } from "commander";
import type { createOutput } from "../lib/output.ts";

export function addNotifyCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  setExitCode: (code: number) => void,
) {
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
    setExitCode(
      output.response(
        await Luna.notify[action](options()),
        (state) => `Notifications: ${state.running ? "running" : "stopped"}`,
      ),
    );
  };
  const render = (value: unknown) =>
    value === null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  group
    .command("get [key]")
    .action(async (key?: string) =>
      setExitCode(output.response(await Luna.notify.get(key, options()), render)),
    );
  group
    .command("get-config-file")
    .action(async () =>
      setExitCode(output.response(await Luna.notify.getConfigFile(options()), render)),
    );
  group.action(() => run("status"));
  for (const action of ["start", "stop", "restart", "status", "focus", "dismiss"] as const)
    group.command(action).action(() => run(action));
}
