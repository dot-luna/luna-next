import { Luna, type ScreenshotMode } from "@luna/api";
import { Argument, InvalidArgumentError, type Command } from "commander";
import type { createOutput } from "../lib/output.ts";

export function addScreenshotCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  json: boolean,
  setExitCode: (code: number) => void,
) {
  const command = program
    .command("screenshot")
    .description("Copy a screenshot or extract English text from a region")
    .addArgument(
      new Argument("[mode]", "Capture target")
        .choices(["region", "screen", "window", "all", "text"])
        .default("region"),
    )
    .option("--directory <path>", "Directory for saved screenshots")
    .option("--config <path>", "Screenshot JSONC settings for text extraction")
    .action(async (mode: ScreenshotMode | "text") => {
      const options = command.opts<{ directory?: string; config?: string }>();
      if (mode === "text") {
        if (options.directory !== undefined)
          throw new InvalidArgumentError(
            "Text extraction does not save screenshots; omit --directory",
          );
        const response = await Luna.screenshot.extractText({ configFile: options.config });
        if (response.succes && !response.data.text && !json) {
          setExitCode(0);
          return;
        }
        setExitCode(output.response(response, (result) => result.text ?? ""));
        return;
      }
      if (options.config !== undefined)
        throw new InvalidArgumentError("--config applies to text extraction only");
      const response = await Luna.screenshot.capture(mode, {
        directory: options.directory,
      });
      // Cancelling the selector is successful and must stay silent outside JSON mode.
      if (response.succes && response.data.cancelled && !json) {
        setExitCode(0);
        return;
      }
      setExitCode(output.response(response, (result) => result.path ?? ""));
    });
}
