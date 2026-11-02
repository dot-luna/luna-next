import { Luna, type ApiResponse, type ThemeMode, type ThemeOptions } from "@luna/api";
import { Argument, type Command } from "commander";
import { createInterface } from "node:readline/promises";
import type { createOutput } from "../lib/output.ts";

function render(value: unknown): string {
  return value === null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** Native Hyprland values contain only validated scalar settings and ASCII object keys. */
function lua(value: unknown): string {
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .map(([key, item]) => `[${JSON.stringify(key)}]=${lua(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function addThemeCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  json: boolean,
  setExitCode: (value: number) => void,
) {
  const group = program
    .command("theme")
    .description("Install and select JSONC themes")
    .option("--config-file <path>", "Theme selection file")
    .option("--library-dir <path>", "Installed theme directory");
  const options = (): ThemeOptions => group.opts<ThemeOptions>();
  const done = <T>(response: ApiResponse<T>, format: (value: T) => string = render) =>
    setExitCode(output.response(response, format));
  group
    .command("install <folder>")
    .description("Validate and copy a theme folder; import its wallpapers")
    .option("--name <name>", "Installed theme name")
    .option("--force", "Replace an existing installed copy")
    .action(async (folder: string, flags: { name?: string; force?: boolean }) =>
      done(await Luna.theme.install(folder, { ...options(), ...flags })),
    );
  group
    .command("list")
    .description("List installed themes")
    .action(async () =>
      done(await Luna.theme.list(options()), (entries) =>
        entries.map((entry) => `${entry.current ? "* " : "  "}${entry.name}`).join("\n"),
      ),
    );
  group
    .command("current")
    .description("Read the selected theme name")
    .action(async () => done(await Luna.theme.current(options())));
  group
    .command("path [name]")
    .description("Locate the theme library or an installed copy")
    .action(async (name?: string) => done(await Luna.theme.path(name, options())));
  group
    .command("get [key]")
    .description("Resolve selected values, with defaults")
    .action(async (key?: string) => done(await Luna.theme.get(key, options())));
  group
    .command("inspect <name>")
    .description("Resolve a theme without selecting it")
    .action(async (name: string) => done(await Luna.theme.inspect(name, options())));
  group
    .command("set <name>")
    .description("Select a theme and apply its system mode")
    .action(async (name: string) =>
      done(await Luna.theme.set(name, options()), (value) => `Theme: ${value.name}`),
    );
  group
    .command("mode")
    .description("Read or change system light/dark preference")
    .addArgument(new Argument("[mode]").choices(["dark", "light", "toggle"]))
    .action(async (mode?: ThemeMode | "toggle") => done(await Luna.theme.mode(mode, options())));
  group
    .command("toggle")
    .description("Toggle system appearance")
    .action(async () => done(await Luna.theme.toggle(options())));
  group
    .command("get-config-file")
    .description("Locate the selection JSONC file")
    .action(async () => done(await Luna.theme.getConfigFile(options())));
  group
    .command("hyprland")
    .description("Render native Hyprland appearance")
    .action(async () =>
      done(await Luna.theme.hyprland(options()), (value) => `return ${lua(value)}`),
    );
  group
    .command("apply")
    .description("Apply palette and fonts through an app's native settings")
    .addArgument(new Argument("<app>").choices(["t3code"]))
    .action(async () =>
      done(await Luna.theme.applyT3code(options()), () => "T3 Code theme and fonts updated."),
    );
  group
    .command("remove <names...>")
    .description("Remove installed copies; protect the selected theme")
    .option("--dry-run", "Preview paths without deleting")
    .option("-y, --yes", "Confirm removal")
    .action(async (names: string[], flags: { dryRun?: boolean; yes?: boolean }) => {
      if (flags.dryRun || flags.yes)
        return done(
          await Luna.theme.remove(names, { ...options(), dryRun: flags.dryRun }),
          (paths) => paths.join("\n"),
        );
      const plan = await Luna.theme.remove(names, { ...options(), dryRun: true });
      if (!plan.succes) return done(plan);
      if (json || !process.stdin.isTTY)
        return done({
          succes: false,
          err: "INPUT_REQUIRED",
          errMessage: "Theme removal requires --yes or --dry-run without an interactive terminal",
        });
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = await prompt.question(
          `${plan.data.join("\n")}\nRemove ${plan.data.length} theme(s)? [y/N] `,
        );
        if (!/^(y|yes)$/iu.test(answer.trim())) return done({ succes: true, data: [] }, () => "");
      } finally {
        prompt.close();
      }
      done(await Luna.theme.remove(names, options()), (paths) => paths.join("\n"));
    });
}
