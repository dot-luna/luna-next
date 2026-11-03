import { Luna, type ApiResponse, type WallpaperOptions } from "@luna/api";
import { InvalidArgumentError, type Command } from "commander";
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
  setExitCode: (code: number) => void,
) {
  const group = program
    .command("wallpaper")
    .description("Manage wallpaper settings and the renderer")
    .option("--install-dir <path>", "Luna source checkout")
    .option("--config <path>", "Wallpaper JSONC file");
  const options = (): WallpaperOptions => {
    const flags = group.opts<{ installDir?: string; config?: string }>();
    return { repository: flags.installDir, configFile: flags.config };
  };
  const done = <T>(response: ApiResponse<T>, format: (value: T) => string = render) =>
    setExitCode(output.response(response, format));
  const run = async (action: "start" | "stop" | "restart" | "reload" | "status") =>
    done(await Luna.wallpaper[action](options()), (state) => `Wallpaper: ${state.status}`);
  const configure = async (settings: unknown) =>
    done(await Luna.wallpaper.configure(settings, options()), () => "Wallpaper updated.");

  group.action(() => run("status"));
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
    .command("set <path>")
    .description('Set an absolute media path; use "" to clear it')
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
