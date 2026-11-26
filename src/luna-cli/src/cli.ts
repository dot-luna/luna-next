import { Luna } from "@luna/api";
import { version as cliVersion } from "../package.json";
import { Command, CommanderError } from "commander";
import { Output } from "@/lib/output.ts";
import { formatInfo } from "@/modules/info/format.ts";
import { addAppCommands } from "@/modules/apps/commands.ts";
import { addBarCommands } from "@/modules/bar/commands.ts";
import { addClipboardCommands } from "@/modules/clipboard/commands.ts";
import { addDefaultsCommands } from "@/modules/defaults/commands.ts";
import { addEmojiCommands } from "@/modules/emoji/commands.ts";
import { addLockCommands } from "@/modules/lock/commands.ts";
import { addLoginCommands } from "@/modules/login/commands.ts";
import { addMenuCommands } from "@/modules/menu/commands.ts";
import { addPolkitCommands } from "@/modules/polkit/commands.ts";
import { addNotifyCommands } from "@/modules/notify/commands.ts";
import { addScreensaverCommands } from "@/modules/screensaver/commands.ts";
import { addScreenshotCommands } from "@/modules/screenshot/commands.ts";
import { addSelfCommands } from "@/modules/self/commands.ts";
import { addThemeCommands } from "@/modules/theme/commands.ts";
import { addToggleCommands } from "@/modules/toggle/commands.ts";
import { addWallpaperCommands } from "@/modules/wallpaper/commands.ts";
import { addWebappCommands } from "@/modules/webapp/commands.ts";

interface GlobalOptions {
  version?: boolean;
}

// Registration order is the command order in help output.
const registrations = [
  addSelfCommands,
  addThemeCommands,
  addAppCommands,
  addWebappCommands,
  addNotifyCommands,
  addPolkitCommands,
  addBarCommands,
  addMenuCommands,
  addEmojiCommands,
  addClipboardCommands,
  addToggleCommands,
  addDefaultsCommands,
  addWallpaperCommands,
  addScreensaverCommands,
  addLockCommands,
  addLoginCommands,
  addScreenshotCommands,
];

/**
 * Run one CLI invocation and return its exit status: 0 on success, 1 for operation
 * failures, 2 for argument errors. Commander owns arguments and help; Luna owns
 * operation responses.
 */
export async function runCli(argv: string[]): Promise<number> {
  // JSON mode must be known before parsing so Commander's own errors can be suppressed.
  const delimiter = argv.indexOf("--");
  const wantsJson = argv.slice(0, delimiter < 0 ? undefined : delimiter).includes("--json");
  const output = new Output(wantsJson);
  const program = new Command()
    .name("luna")
    .option("-v, --version", "Show this CLI executable's version")
    .option("--json", "Return the API response unchanged as JSON")
    .exitOverride()
    .configureOutput({
      writeOut: output.writeOut,
      writeErr: wantsJson ? () => {} : output.writeErr,
    });

  for (const register of registrations) register(program, output);

  program.action(async () => {
    if (program.opts<GlobalOptions>().version) {
      // Bundled at build time, so a fetched checkout cannot relabel an older installed CLI.
      output.response({ succes: true, data: { version: cliVersion } }, (data) => data.version);
      return;
    }
    const response = await Luna.info();
    output.response(response, formatInfo);
    if (response.succes && !wantsJson) {
      output.writeOut("\n");
      program.outputHelp();
    }
  });

  try {
    await program.parseAsync(argv, { from: "user" });
    return output.exitCode;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return output.exitCode;
    const argumentError = error instanceof CommanderError;
    // Commander already prints human argument errors; JSON mode suppresses that output.
    if (wantsJson || !argumentError) {
      output.response(
        {
          succes: false,
          err: argumentError ? "INVALID_ARGUMENT" : "INTERNAL_ERROR",
          errMessage: error instanceof Error ? error.message : String(error),
        },
        () => "",
      );
    }
    return argumentError ? 2 : 1;
  }
}
