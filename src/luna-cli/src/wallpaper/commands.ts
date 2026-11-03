import { Luna, type ApiResponse, type WallpaperOptions } from "@luna/api";
import { InvalidArgumentError, type Command } from "commander";
import { createInterface } from "node:readline/promises";
import type { createOutput } from "../lib/output.ts";

function render(value: unknown): string {
  return value === null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function boolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new InvalidArgumentError("Expected true or false");
}

function milliseconds(value: string): number {
  const duration = Number(value);
  if (!value.trim() || !Number.isFinite(duration))
    throw new InvalidArgumentError("Expected a duration in milliseconds");
  return duration;
}

export function addWallpaperCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  json: boolean,
  setExitCode: (code: number) => void,
) {
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
  const done = <T>(response: ApiResponse<T>, format: (value: T) => string = render) =>
    setExitCode(output.response(response, format));
  const run = async (action: "start" | "stop" | "restart" | "reload" | "status") =>
    done(await Luna.wallpaper[action](options()), (state) => `Wallpaper: ${state.status}`);
  const configure = async (settings: unknown) =>
    done(await Luna.wallpaper.configure(settings, options()), () => "Wallpaper updated.");

  group.action(() => run("status"));
  group
    .command("install <sources...>")
    .alias("add")
    .description("Copy local media or download a URL into the wallpaper library")
    .option("--name <name>", "Installed filename for a single wallpaper")
    .option("-r, --recursive", "Include media in subdirectories")
    .action(async (sources: string[], flags: { name?: string; recursive?: boolean }) =>
      done(await Luna.wallpaper.install(sources, { ...options(), ...flags }), (entries) =>
        entries.map((entry) => entry.path).join("\n"),
      ),
    );
  group
    .command("list")
    .description("List installed wallpapers")
    .action(async () =>
      done(await Luna.wallpaper.list(options()), (entries) =>
        entries.map((entry) => `${entry.current ? "* " : "  "}${entry.name}`).join("\n"),
      ),
    );
  group
    .command("current")
    .description("Read the selected wallpaper path")
    .action(async () => done(await Luna.wallpaper.current(options())));
  group
    .command("path [name]")
    .alias("dir")
    .description("Locate the wallpaper library or an installed file")
    .action(async (name?: string) => done(await Luna.wallpaper.path(name, options())));
  group
    .command("random")
    .description("Select a random installed wallpaper")
    .action(async () => done(await Luna.wallpaper.random(options()), () => "Wallpaper updated."));
  group
    .command("remove <names...>")
    .description("Remove installed wallpapers; protect selected and playing media")
    .option("--dry-run", "Preview paths without deleting")
    .option("-y, --yes", "Confirm removal")
    .action(async (names: string[], flags: { dryRun?: boolean; yes?: boolean }) => {
      if (flags.dryRun || flags.yes)
        return done(
          await Luna.wallpaper.remove(names, { ...options(), dryRun: flags.dryRun }),
          (paths) => paths.join("\n"),
        );
      const plan = await Luna.wallpaper.remove(names, { ...options(), dryRun: true });
      if (!plan.succes) return done(plan);
      if (json || !process.stdin.isTTY)
        return done({
          succes: false,
          err: "INPUT_REQUIRED",
          errMessage:
            "Wallpaper removal requires --yes or --dry-run without an interactive terminal",
        });
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = await prompt.question(
          `${plan.data.join("\n")}\nRemove ${plan.data.length} wallpaper(s)? [y/N] `,
        );
        if (!/^(y|yes)$/iu.test(answer.trim())) return done({ succes: true, data: [] }, () => "");
      } finally {
        prompt.close();
      }
      done(await Luna.wallpaper.remove(names, options()), (paths) => paths.join("\n"));
    });
  for (const action of ["start", "stop", "restart", "reload", "status"] as const)
    group.command(action).action(() => run(action));
  group
    .command("get [key]")
    .description("Read a setting or the saved settings")
    .action(async (key?: string) => done(await Luna.wallpaper.get(key, options())));
  group
    .command("get-config-file")
    .description("Locate the wallpaper JSONC file")
    .action(async () => done(await Luna.wallpaper.getConfigFile(options())));
  group
    .command("set <name-or-path>")
    .description('Select an installed name or absolute media path; use "" to clear it')
    .action(async (source: string) =>
      done(await Luna.wallpaper.set(source, options()), () => "Wallpaper updated."),
    );
  group
    .command("fit <mode>")
    .description("Set media sizing")
    .action(async (fit: string) => configure({ wallpaper: { fit } }));
  group
    .command("background <color>")
    .description("Set the background color")
    .action(async (background_color: string) => configure({ wallpaper: { background_color } }));
  group
    .command("pause-when-inactive")
    .description("Pause media on an inactive output (true or false)")
    .argument("<value>", "true or false", boolean)
    .action(async (pause_when_output_inactive: boolean) =>
      configure({ playback: { pause_when_output_inactive } }),
    );
  group
    .command("transition <type>")
    .description("Set the transition and optional duration in milliseconds")
    .argument("[duration]", "Duration in milliseconds", milliseconds)
    .action(async (type: string, duration_ms?: number) =>
      configure({ transition: { type, ...(duration_ms === undefined ? {} : { duration_ms }) } }),
    );
}
