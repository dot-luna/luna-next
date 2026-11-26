import { Luna, type WallpaperOptions } from "@luna/api";
import { InvalidArgumentError, type Command } from "commander";
import type { Output } from "@/lib/output.ts";
import { confirmRemoval } from "@/lib/removal.ts";

function boolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new InvalidArgumentError("Expected true or false");
}

export function addWallpaperCommands(program: Command, output: Output) {
  const group = program
    .command("wallpaper")
    .description("Install, select, and manage wallpapers")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--config <path>", "Wallpaper JSONC file")
    .option("--library-dir <path>", "Installed wallpaper directory");
  const options = (): WallpaperOptions => {
    const flags = group.opts<{ installDir?: string; config?: string; libraryDir?: string }>();
    return {
      repository: flags.installDir,
      configFile: flags.config,
      libraryDir: flags.libraryDir,
    };
  };
  const run = async (action: "start" | "stop" | "restart" | "reload" | "status") =>
    output.response(
      await Luna.wallpaper[action](options()),
      (state) => `Wallpaper: ${state.status}`,
    );
  const configure = async (settings: unknown) =>
    output.response(
      await Luna.wallpaper.configure(settings, options()),
      () => "Wallpaper updated.",
    );

  group.action(() => run("status"));
  group
    .command("watch")
    .description("Reload valid configuration changes automatically")
    .argument("<enabled>", "true or false", boolean)
    .action(async (enabled: boolean) =>
      output.response(await Luna.wallpaper.watch(enabled, options()), () => "Wallpaper updated."),
    );
  group
    .command("install <sources...>")
    .alias("add")
    .description("Copy local media or download a URL into the wallpaper library")
    .option("--name <name>", "Installed filename for a single wallpaper")
    .option("-r, --recursive", "Include media in subdirectories")
    .action(async (sources: string[], flags: { name?: string; recursive?: boolean }) =>
      output.response(
        await Luna.wallpaper.install(sources, { ...options(), ...flags }),
        (entries) => entries.map((entry) => entry.path).join("\n"),
      ),
    );
  group
    .command("list")
    .description("List installed wallpapers")
    .action(async () =>
      output.response(await Luna.wallpaper.list(options()), (entries) =>
        entries.map((entry) => `${entry.current ? "* " : "  "}${entry.name}`).join("\n"),
      ),
    );
  group
    .command("current")
    .description("Read the selected wallpaper path")
    .action(async () => output.response(await Luna.wallpaper.current(options())));
  group
    .command("path [name]")
    .alias("dir")
    .description("Locate the wallpaper library or an installed file")
    .action(async (name?: string) => output.response(await Luna.wallpaper.path(name, options())));
  group
    .command("random")
    .description("Select a random installed wallpaper")
    .action(async () =>
      output.response(await Luna.wallpaper.random(options()), () => "Wallpaper updated."),
    );
  group
    .command("remove <names...>")
    .description("Remove installed wallpapers; protect selected and playing media")
    .option("--dry-run", "Preview paths without deleting")
    .option("-y, --yes", "Confirm removal")
    .action(async (names: string[], flags: { dryRun?: boolean; yes?: boolean }) => {
      await confirmRemoval({
        output,
        label: "Wallpaper",
        flags,
        remove: (dryRun) => Luna.wallpaper.remove(names, { ...options(), dryRun }),
      });
    });
  for (const action of ["start", "stop", "restart", "reload", "status"] as const)
    group.command(action).action(() => run(action));
  group
    .command("get [key]")
    .description("Read a setting or the saved settings")
    .action(async (key?: string) => output.response(await Luna.wallpaper.get(key, options())));
  group
    .command("get-config-file")
    .description("Locate the wallpaper JSONC file")
    .action(async () => output.response(await Luna.wallpaper.getConfigFile(options())));
  group
    .command("set <name-or-path>")
    .description('Select an installed name or absolute media path; use "" to clear it')
    .option("--login", "Set only the Login background using a local image")
    .option("--login-config <path>", "Login JSONC file when using --login")
    .option("--system-root <path>", "SDDM filesystem root when using --login")
    .action(
      async (
        source: string,
        flags: { login?: boolean; loginConfig?: string; systemRoot?: string },
      ) => {
        if (flags.login) {
          output.response<unknown>(
            await Luna.wallpaper.set(source, {
              ...options(),
              login: true,
              loginConfigFile: flags.loginConfig,
              systemRoot: flags.systemRoot,
            }),
            () => "Login wallpaper updated.",
          );
        } else {
          if (flags.loginConfig || flags.systemRoot)
            throw new InvalidArgumentError("--login-config and --system-root require --login");
          output.response<unknown>(
            await Luna.wallpaper.set(source, options()),
            () => "Wallpaper updated.",
          );
        }
      },
    );
  group
    .command("background <color>")
    .description("Set the background color")
    .action(async (background_color: string) => configure({ wallpaper: { background_color } }));
}
