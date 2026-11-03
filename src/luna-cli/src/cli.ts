import { Luna } from "@luna/api";
import { Command, CommanderError } from "commander";
import { formatInfo } from "./info/format.ts";
import { createOutput } from "./lib/output.ts";
import { addSelfCommands } from "./self/commands.ts";
import { addThemeCommands } from "./theme/commands.ts";
import { addAppCommands } from "./apps/commands.ts";
import { addMenuCommands } from "./menu/commands.ts";
import { addDefaultsCommands } from "./defaults/commands.ts";
import { addWallpaperCommands } from "./wallpaper/commands.ts";
import { addScreensaverCommands } from "./screensaver/commands.ts";

import { addWebappCommands } from "./webapp/commands.ts";

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
    .option("-v, --version", "Show the repository version")
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
  addMenuCommands(program, output, (value) => {
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

  program.action(async () => {
    const versionOnly = program.opts<GlobalOptions>().version;
    const response = await Luna.info();
    exitCode = output.response(response, versionOnly ? (data) => data.version : formatInfo);
    if (response.succes && !versionOnly && !wantsJson) {
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
