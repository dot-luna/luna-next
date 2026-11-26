import { Luna, type LoginOptions } from "@luna/api";
import { InvalidArgumentError, type Command } from "commander";
import type { Output } from "@/lib/output.ts";

function json(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new InvalidArgumentError("Expected a JSON settings object");
  }
}

export function addLoginCommands(program: Command, output: Output) {
  const group = program
    .command("login")
    .description("Build, preview, and install Luna's SDDM login screen")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--config <path>", "Login JSONC file")
    .option("--system-root <path>", "SDDM filesystem root for an offline installation");
  const options = (): LoginOptions => {
    const flags = group.opts<{ installDir?: string; config?: string; systemRoot?: string }>();
    return { repository: flags.installDir, configFile: flags.config, systemRoot: flags.systemRoot };
  };
  const status = async () =>
    output.response(
      await Luna.login.status(options()),
      (state) =>
        `Login: ${state.selected ? "selected" : state.installed ? "installed" : "not installed"}`,
    );
  group.action(status);
  group.command("status").action(status);
  group
    .command("build <output>")
    .description("Prepare a portable theme without installing it")
    .action(async (path: string) => output.response(await Luna.login.build(path, options())));
  group
    .command("preview")
    .description("Open SDDM test mode without changing the installed theme")
    .action(async () =>
      output.response(await Luna.login.preview(options()), () => "Preview closed."),
    );
  group
    .command("install")
    .description("Deploy and select Luna for the next login")
    .action(async () =>
      output.response(
        await Luna.login.install(options()),
        () => "Luna Login installed for the next login.",
      ),
    );
  group
    .command("uninstall")
    .description("Remove Luna's theme and its SDDM activation block")
    .action(async () =>
      output.response(await Luna.login.uninstall(options()), () => "Luna Login uninstalled."),
    );
  group
    .command("get [key]")
    .description("Read saved settings or one dot-separated key")
    .action(async (key?: string) => output.response(await Luna.login.getConfig(key, options())));
  group
    .command("get-config-file")
    .description("Locate the Login JSONC file")
    .action(async () => output.response(await Luna.login.getConfigFile(options())));
  group
    .command("configure")
    .description("Merge settings and refresh the installed theme")
    .argument("<json>", "JSON settings patch", json)
    .action(async (patch: unknown) =>
      output.response(await Luna.login.updateConfig(patch, options()), () => "Login updated."),
    );
  group
    .command("wallpaper <path>")
    .description("Replace Login's managed background image")
    .action(async (source: string) =>
      output.response(
        await Luna.login.setWallpaper(source, options()),
        () => "Login wallpaper updated.",
      ),
    );
}
