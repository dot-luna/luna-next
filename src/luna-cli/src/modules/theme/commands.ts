import { Luna, type ThemeMode, type ThemeOptions } from "@luna/api";
import { Argument, type Command } from "commander";
import type { Output } from "@/lib/output.ts";
import { confirmRemoval } from "@/lib/removal.ts";

/** Native Hyprland values contain only validated scalar settings and ASCII object keys. */
function lua(value: unknown): string {
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .map(([key, item]) => `[${JSON.stringify(key)}]=${lua(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function addThemeCommands(program: Command, output: Output) {
  const group = program
    .command("theme")
    .description("Install and select JSONC themes")
    .option("--config-file <path>", "Theme selection file")
    .option("--library-dir <path>", "Installed theme directory");
  const options = (): ThemeOptions => group.opts<ThemeOptions>();
  group
    .command("install <folder>")
    .description("Validate and copy a theme folder; import its wallpapers")
    .option("--name <name>", "Installed theme name")
    .option("--force", "Replace an existing installed copy")
    .action(async (folder: string, flags: { name?: string; force?: boolean }) =>
      output.response(await Luna.theme.install(folder, { ...options(), ...flags })),
    );
  group
    .command("list")
    .description("List installed themes")
    .action(async () =>
      output.response(await Luna.theme.list(options()), (entries) =>
        entries.map((entry) => `${entry.current ? "* " : "  "}${entry.name}`).join("\n"),
      ),
    );
  group
    .command("current")
    .description("Read the selected theme name")
    .action(async () => output.response(await Luna.theme.current(options())));
  group
    .command("path [name]")
    .description("Locate the theme library or an installed copy")
    .action(async (name?: string) => output.response(await Luna.theme.path(name, options())));
  group
    .command("get [key]")
    .description("Resolve selected values, with defaults")
    .action(async (key?: string) => output.response(await Luna.theme.get(key, options())));
  group
    .command("inspect <name>")
    .description("Resolve a theme without selecting it")
    .action(async (name: string) => output.response(await Luna.theme.inspect(name, options())));
  group
    .command("set <name>")
    .description("Select a theme and apply its system mode")
    .action(async (name: string) =>
      output.response(await Luna.theme.set(name, options()), (value) => `Theme: ${value.name}`),
    );
  group
    .command("mode")
    .description("Read or change system light/dark preference")
    .addArgument(new Argument("[mode]").choices(["dark", "light", "toggle"]))
    .action(async (mode?: ThemeMode | "toggle") =>
      output.response(await Luna.theme.mode(mode, options())),
    );
  group
    .command("toggle")
    .description("Toggle system appearance")
    .action(async () => output.response(await Luna.theme.toggle(options())));
  group
    .command("get-config-file")
    .description("Locate the selection JSONC file")
    .action(async () => output.response(await Luna.theme.getConfigFile(options())));
  group
    .command("hyprland")
    .description("Render native Hyprland appearance")
    .action(async () =>
      output.response(await Luna.theme.hyprland(options()), (value) => `return ${lua(value)}`),
    );
  group
    .command("apply")
    .description("Apply palette and fonts through an app's native settings")
    .addArgument(new Argument("<app>").choices(["t3code"]))
    .action(async () =>
      output.response(
        await Luna.theme.applyT3code(options()),
        () => "T3 Code theme and fonts updated.",
      ),
    );
  group
    .command("remove <names...>")
    .description("Remove installed copies; protect the selected theme")
    .option("--dry-run", "Preview paths without deleting")
    .option("-y, --yes", "Confirm removal")
    .action(async (names: string[], flags: { dryRun?: boolean; yes?: boolean }) => {
      await confirmRemoval({
        output,
        label: "Theme",
        flags,
        remove: (dryRun) => Luna.theme.remove(names, { ...options(), dryRun }),
      });
    });
}
