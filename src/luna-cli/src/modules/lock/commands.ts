import { Luna, type LockOptions } from "@luna/api";
import { InvalidArgumentError, type Command } from "commander";
import { duration } from "@/lib/arguments.ts";
import type { Output } from "@/lib/output.ts";

export function addLockCommands(program: Command, output: Output) {
  const group = program
    .command("lock")
    .description("Lock the session and configure idle display power")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--config <path>", "Lock JSONC file")
    .option("--launcher <path>", "Luna executable for idle and display events");
  const options = (): LockOptions => {
    const flags = group.opts<{ installDir?: string; config?: string; launcher?: string }>();
    return {
      repository: flags.installDir,
      configFile: flags.config,
      launcher: flags.launcher,
    };
  };
  const run = async (
    action: "start" | "lock" | "lockIdle" | "stop" | "restart" | "reload" | "status",
  ) => output.response(await Luna.lock[action](options()), (state) => `Lock: ${state.status}`);

  group.action(() => run("lock"));
  group.command("lock-idle", { hidden: true }).action(() => run("lockIdle"));
  group.command("open").action(() => run("lock"));
  group
    .command("preview")
    .description("Preview the screen in a window without locking or authenticating")
    .action(async () =>
      output.response(await Luna.lock.preview(options()), () => "Preview closed."),
    );
  group
    .command("configure <json>")
    .description("Merge saved settings and reload a running lock")
    .action(async (source: string) => {
      let patch: unknown;
      try {
        patch = JSON.parse(source);
      } catch {
        throw new InvalidArgumentError("Expected a JSON settings object");
      }
      output.response(await Luna.lock.configure(patch, options()), () => "Lock updated.");
    });
  for (const action of ["start", "lock", "stop", "restart", "reload", "status"] as const)
    group.command(action).action(() => run(action));
  group
    .command("display", { hidden: true })
    .argument("<state>", "Display power", (value: string): "on" | "off" => {
      if (value !== "on" && value !== "off")
        throw new InvalidArgumentError("Display power must be on or off");
      return value;
    })
    .action(async (value: "on" | "off") =>
      output.response(await Luna.lock.display(value, options())),
    );
  group
    .command("get [key]")
    .description("Read a setting or the saved settings")
    .action(async (key?: string) => output.response(await Luna.lock.get(key, options())));
  group
    .command("get-config-file")
    .description("Locate the lock JSONC file")
    .action(async () => output.response(await Luna.lock.getConfigFile(options())));
  for (const [command, key, description] of [
    ["set-idle", "idle_seconds", "Set automatic locking in seconds; 0 disables it"],
    ["set-dpms", "dpms_seconds", "Set display power-off while locked in seconds; 0 disables it"],
  ] as const)
    group
      .command(command)
      .description(description)
      .argument("<seconds>", "Idle duration in seconds", duration("seconds"))
      .action(async (seconds: number) =>
        output.response(
          await Luna.lock.configure({ [key]: seconds }, options()),
          () => "Lock updated.",
        ),
      );
}
