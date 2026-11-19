import { Luna } from "@luna/api";
import { version as cliVersion } from "../package.json";
import { Command, CommanderError } from "commander";
import { formatInfo } from "./info/format.ts";
import { createOutput } from "./lib/output.ts";
import { addSelfCommands } from "./self/commands.ts";
import { addThemeCommands } from "./theme/commands.ts";
import { addAppCommands } from "./modules/apps/commands.ts";
import { addNotifyCommands } from "./notify/commands.ts";
import { addMenuCommands } from "./menu/commands.ts";
import { addBarCommands } from "./bar/commands.ts";
import { addToggleCommands } from "./toggle/commands.ts";
import { addDefaultsCommands } from "./defaults/commands.ts";
import { addWallpaperCommands } from "./wallpaper/commands.ts";
import { addScreensaverCommands } from "./screensaver/commands.ts";
import { addLockCommands } from "./lock/commands.ts";
import { addScreenshotCommands } from "./screenshot/commands.ts";

import { addWebappCommands } from "./modules/webapp/commands.ts";
import { addClipboardCommands } from "./modules/clipboard/commands.ts";

import { addEmojiCommands } from "./modules/emoji/commands.ts";

interface GlobalOptions {
  version?: boolean;
}

/** Commander owns arguments and help; Luna owns operation responses. */
export async function runCli(argv: string[]): Promise<number> {
  const delimiter = argv.indexOf("--");
  const wantsJson = argv.slice(0, delimiter < 0 ? undefined : delimiter).includes("--json");
  const output = createOutput(wantsJson);
  let exitCode = 0;
  const program = new Command()
    .name("luna")
    .option("-v, --version", "Show this CLI executable's version")
    .option("--json", "Return the API response unchanged as JSON")
    .exitOverride()
    .configureOutput({
      writeOut: output.writeOut,
      writeErr: wantsJson ? () => {} : output.writeErr,
    });

  addSelfCommands(program, output, wantsJson, (value) => {
    exitCode = value;
  });
  addThemeCommands(program, output, wantsJson, (value) => {
    exitCode = value;
  });
  addAppCommands(program, output, (value) => {
    exitCode = value;
  });

  addWebappCommands(program, output, wantsJson, (value) => {
    exitCode = value;
  });
  addNotifyCommands(program, output, (value) => {
    exitCode = value;
  });
  addBarCommands(program, output, (value) => {
    exitCode = value;
  });
  addMenuCommands(program, output, (value) => {
    exitCode = value;
  });
  addEmojiCommands(program, output, (value) => {
    exitCode = value;
  });
  addClipboardCommands(program, output, (value) => {
    exitCode = value;
  });
  addToggleCommands(program, output, (value) => {
    exitCode = value;
  });
  addDefaultsCommands(program, output, (value) => {
    exitCode = value;
  });
  addWallpaperCommands(program, output, wantsJson, (value) => {
    exitCode = value;
  });
  addScreensaverCommands(program, output, (value) => {
    exitCode = value;
  });
  addLockCommands(program, output, (value) => {
    exitCode = value;
  });
  addScreenshotCommands(program, output, wantsJson, (value) => {
    exitCode = value;
  });

  program.action(async () => {
    const versionOnly = program.opts<GlobalOptions>().version;
    if (versionOnly) {
      // Bundled at build time, so a fetched checkout cannot relabel an older installed CLI.
      exitCode = output.response(
        { succes: true, data: { version: cliVersion } },
        (data) => data.version,
      );
      return;
    }
    const response = await Luna.info();
    exitCode = output.response(response, formatInfo);
    if (response.succes && !wantsJson) {
      output.writeOut("\n");
      program.outputHelp();
    }
  });

  try {
    await program.parseAsync(argv, { from: "user" });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return exitCode;
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
