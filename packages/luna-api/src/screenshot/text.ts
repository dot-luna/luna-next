import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "pathe";
import { locked } from "../lib/files.ts";
import { ApiError } from "../lib/response.ts";
import {
  checked,
  notify,
  screenshotRuntime,
  type ScreenshotTextOptions,
  type ScreenshotTextResult,
} from "./context.ts";
import { capturePng, copyFile } from "./files.ts";
import { captureArguments, settleMenu } from "./selection.ts";
import { textSettings } from "./settings.ts";

export async function extractText(options: ScreenshotTextOptions): Promise<ScreenshotTextResult> {
  const context = screenshotRuntime(options);
  try {
    const settings = await textSettings(context, options);
    for (const tool of ["grim", "slurp", "tesseract", "wl-copy"]) {
      if (!Bun.which(tool, { PATH: context.env.PATH ?? "" }))
        throw new ApiError(
          "COMMAND_FAILED",
          `Install ${tool} with luna install luna-screenshot before extracting text`,
        );
    }
    const languages = await checked(context, ["tesseract", "--list-langs"]);
    if (!languages.split(/\r?\n/u).some((line) => line.trim() === "eng"))
      throw new ApiError("COMMAND_FAILED", "Install tesseract-data-eng before extracting text");
    return await locked(
      { configFile: join(context.runtime, "capture"), env: context.env },
      async () => {
        await settleMenu(context, options);
        const args = await captureArguments(context, "region");
        if (args === null) return { cancelled: true, text: null };
        // Keep captured pixels and recognized text private and transient, including on failures.
        const temporary = await mkdtemp(join(context.runtime, "text-"));
        try {
          const image = join(temporary, "capture.png");
          await capturePng(context, args, image);
          const text = await checked(
            context,
            [
              "tesseract",
              image,
              "stdout",
              "-l",
              "eng",
              "--oem",
              "1",
              "--psm",
              String({ block: 6, line: 7, sparse: 11 }[settings.layout]),
              "-c",
              `preserve_interword_spaces=${settings.preserve_spaces ? 1 : 0}`,
            ],
            30_000,
          );
          if (!text) {
            await notify(context, "No text found", "Select a region containing English text.");
            return { cancelled: false, text: "" };
          }
          const output = join(temporary, "text.txt");
          await writeFile(output, text, { mode: 0o600 });
          await copyFile(context, output, "text/plain;charset=utf-8");
          await notify(context, "Text copied", "Copied to the clipboard.");
          return { cancelled: false, text };
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
      },
    );
  } catch (error) {
    await notify(
      context,
      "Text extraction failed",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}
