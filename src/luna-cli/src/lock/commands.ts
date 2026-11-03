import { Luna, type ApiResponse, type LockOptions } from "@luna/api";
import { InvalidArgumentError, type Command } from "commander";
import type { createOutput } from "../lib/output.ts";

function render(value: unknown): string {
  return value === null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function seconds(value: string): number {
  const duration = Number(value);
  if (!value.trim() || !Number.isFinite(duration))
    throw new InvalidArgumentError("Expected a duration in seconds");
  return duration;
}

export function addLockCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  setExitCode: (code: number) => void,
) {
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
  const done = <T>(response: ApiResponse<T>, format: (value: T) => string = render) =>
    setExitCode(output.response(response, format));
  const run = async (
    action: "start" | "lock" | "lockIdle" | "stop" | "restart" | "reload" | "status",
  ) => done(await Luna.lock[action](options()), (state) => `Lock: ${state.status}`);

  group.action(() => run("lock"));
  group.command("lock-idle", { hidden: true }).action(() => run("lockIdle"));
  group.command("open").action(() => run("lock"));
  for (const action of ["start", "lock", "stop", "restart", "reload", "status"] as const)
    group.command(action).action(() => run(action));
  group
    .command("display", { hidden: true })
    .argument("<state>", "Display power", (value: string): "on" | "off" => {
      if (value !== "on" && value !== "off")
        throw new InvalidArgumentError("Display power must be on or off");
      return value;
    })
    .action(async (value: "on" | "off") => done(await Luna.lock.display(value, options())));
  group
    .command("get [key]")
    .description("Read a setting or the saved settings")
    .action(async (key?: string) => done(await Luna.lock.get(key, options())));
  group
    .command("get-config-file")
    .description("Locate the lock JSONC file")
    .action(async () => done(await Luna.lock.getConfigFile(options())));
  for (const [command, key, description] of [
    ["set-idle", "idle_seconds", "Set automatic locking in seconds; 0 disables it"],
    ["set-dpms", "dpms_seconds", "Set display power-off while locked in seconds; 0 disables it"],
  ] as const)
    group
      .command(command)
      .description(description)
      .argument("<seconds>", "Idle duration in seconds", seconds)
      .action(async (duration: number) =>
        done(await Luna.lock.configure({ [key]: duration }, options()), () => "Lock updated."),
      );
}
