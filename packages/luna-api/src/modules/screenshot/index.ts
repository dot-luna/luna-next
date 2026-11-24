import { respond } from "@/lib/response.ts";
import type { ScreenshotMode, ScreenshotOptions, ScreenshotTextOptions } from "./context.ts";
import { screenshotCapture } from "./capture.ts";
import { screenshotText } from "./text.ts";

/** Captures and text extraction share one lock; a concurrent call fails with CONFLICT. */
class Screenshot {
  /**
   * Select a region and copy English text. Cancellation and empty recognition keep the
   * clipboard; temporary captures are removed on success and failure.
   */
  extractText(options: ScreenshotTextOptions = {}) {
    return respond(() => screenshotText.extract(options));
  }

  /**
   * Save and copy a PNG, or return silent cancellation without a file. Clipboard failures
   * retain the completed image and report its path.
   */
  capture(mode: ScreenshotMode = "region", options: ScreenshotOptions = {}) {
    return respond(() => screenshotCapture.capture({ mode, options }));
  }
}

export const screenshot = new Screenshot();
