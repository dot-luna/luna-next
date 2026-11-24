import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "pathe";
import { locked } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import {
  screenshotContext,
  type ScreenshotTextOptions,
  type ScreenshotTextResult,
} from "./context.ts";
import { screenshotFiles } from "./files.ts";
import { screenshotSelection } from "./selection.ts";
import { screenshotSettings } from "./settings.ts";
import { screenshotTools } from "./tools.ts";

const pageSegmentation = { block: 6, line: 7, sparse: 11 };

class ScreenshotText {
  /** Select a region, recognize English text with Tesseract and copy it under the capture lock. */
  async extract(options: ScreenshotTextOptions): Promise<ScreenshotTextResult> {
    const context = screenshotContext.runtime(options);
    try {
      const settings = await screenshotSettings.text({ context, configFile: options.configFile });
      for (const tool of ["grim", "slurp", "tesseract", "wl-copy"]) {
        if (!Bun.which(tool, { PATH: context.env.PATH ?? "" }))
          throw new ApiError(
            "COMMAND_FAILED",
            `Install ${tool} with luna install luna-screenshot before extracting text`,
          );
      }
      const languages = await screenshotTools.checked({
        context,
        args: ["tesseract", "--list-langs"],
      });
      if (!languages.split(/\r?\n/u).some((line) => line.trim() === "eng"))
        throw new ApiError("COMMAND_FAILED", "Install tesseract-data-eng before extracting text");
      return await locked(
        { configFile: join(context.runtime, "capture"), env: context.env },
        async () => {
          await screenshotSelection.settleMenu({ context, repository: options.repository });
          const args = await screenshotSelection.captureArguments({ context, mode: "region" });
          if (args === null) return { cancelled: true, text: null };
          // Keep captured pixels and recognized text private and transient, including on failures.
          const temporary = await mkdtemp(join(context.runtime, "text-"));
          try {
            const image = join(temporary, "capture.png");
            await screenshotFiles.capturePng({ context, args, path: image });
            const text = await screenshotTools.checked({
              context,
              args: [
                "tesseract",
                image,
                "stdout",
                "-l",
                "eng",
                "--oem",
                "1",
                "--psm",
                String(pageSegmentation[settings.layout]),
                "-c",
                `preserve_interword_spaces=${settings.preserve_spaces ? 1 : 0}`,
              ],
              timeout: 30_000,
            });
            if (!text) {
              await screenshotTools.notify({
                context,
                title: "No text found",
                body: "Select a region containing English text.",
              });
              return { cancelled: false, text: "" };
            }
            const output = join(temporary, "text.txt");
            await writeFile(output, text, { mode: 0o600 });
            await screenshotFiles.copy({ context, path: output, mime: "text/plain;charset=utf-8" });
            await screenshotTools.notify({
              context,
              title: "Text copied",
              body: "Copied to the clipboard.",
            });
            return { cancelled: false, text };
          } finally {
            await rm(temporary, { recursive: true, force: true });
          }
        },
      );
    } catch (error) {
      await screenshotTools.notify({
        context,
        title: "Text extraction failed",
        body: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const screenshotText = new ScreenshotText();
