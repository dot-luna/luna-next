import { Luna, type ScreenshotMode } from "@luna/api";
import { Argument, type Command } from "commander";
import type { createOutput } from "../lib/output.ts";

export function addScreenshotCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  json: boolean,
  setExitCode: (code: number) => void,
) {
  const command = program
    .command("screenshot")
    .description("Save a screenshot and copy it to the clipboard")
    .addArgument(
      new Argument("[mode]", "Capture target")
        .choices(["region", "screen", "window", "all"])
        .default("region"),
    )
    .option("--directory <path>", "Directory for saved screenshots")
    .action(async (mode: ScreenshotMode) => {
      const response = await Luna.screenshot.capture(mode, {
        directory: command.opts<{ directory?: string }>().directory,
      });
      // Cancelling the selector is successful and must stay silent outside JSON mode.
      if (response.succes && response.data.cancelled && !json) {
        setExitCode(0);
        return;
      }
      setExitCode(output.response(response, (result) => result.path ?? ""));
    });
}
