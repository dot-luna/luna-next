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
    .option("--install-dir <path>", "Luna source checkout");
  const options = (): NotifyOptions => ({
    repository: group.opts<{ installDir?: string }>().installDir,
  });
  const run = async (action: keyof typeof Luna.notify) => {
    setExitCode(
      output.response(
        await Luna.notify[action](options()),
        (state) => `Notifications: ${state.running ? "running" : "stopped"}`,
      ),
    );
  };
  group.action(() => run("status"));
  for (const action of ["start", "stop", "restart", "status", "focus", "dismiss"] as const)
    group.command(action).action(() => run(action));
}
