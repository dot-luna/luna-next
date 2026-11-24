import { isAbsolute, join, resolve } from "pathe";
import { lunaConfigHome } from "@/lib/env.ts";
import { readDocument } from "@/lib/files.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";
import type { ScreenshotContext } from "./context.ts";
import { screenshotSettingsSchema } from "./schema.ts";

class ScreenshotSettings {
  /**
   * Read OCR settings from configFile or screenshot.jsonc in Luna's config home, creating an
   * empty file when missing. Defaults are applied in memory only.
   */
  async text({ context, configFile }: { context: ScreenshotContext; configFile?: string }) {
    const home = lunaConfigHome(context.env);
    if (home && !isAbsolute(home))
      throw new ApiError("INVALID_PATH", "Screenshot configuration home must be absolute");
    const file = configFile ?? (home ? join(home, "screenshot.jsonc") : undefined);
    if (!file || hasControlCharacters(file) || resolve(file) === "/")
      throw new ApiError("INVALID_PATH", "Set a screenshot config file or HOME");
    const document = await readDocument(resolve(file));
    const parsed = screenshotSettingsSchema.safeParse(document.value);
    if (!parsed.success)
      throw new ApiError(
        "INVALID_METADATA",
        `Invalid screenshot settings: ${parsed.error.message}`,
      );
    return {
      layout: parsed.data.text?.layout ?? "block",
      preserve_spaces: parsed.data.text?.preserve_spaces ?? false,
    };
  }
}

export const screenshotSettings = new ScreenshotSettings();
