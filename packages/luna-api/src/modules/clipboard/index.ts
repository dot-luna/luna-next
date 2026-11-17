import { respond } from "@/lib/response.ts";
import {
  clipboardContext,
  command,
  type ClipboardOptions,
  type ClipboardPasteOptions,
} from "./context.ts";
import * as history from "./history.ts";
import { activeWindow, paste } from "./paste.ts";
import { start } from "./watcher.ts";

/** Each call uses the supplied environment. Reading history never changes the current clipboard. */
class Clipboard {
  start(options: ClipboardOptions = {}) {
    return respond(() => start(clipboardContext(options)));
  }
  list(options: ClipboardOptions = {}) {
    return respond(() => history.list(clipboardContext(options)));
  }
  preview(id: string, options: ClipboardOptions = {}) {
    return respond(() => history.preview({ context: clipboardContext(options), id }));
  }
  copy(id: string, options: ClipboardOptions = {}) {
    return respond(() => history.copy({ context: clipboardContext(options), id }));
  }
  /** Copy and paste into the saved target; on focus failure the copied content remains available. */
  paste(id: string, options: ClipboardPasteOptions = {}) {
    return respond(() => paste({ context: clipboardContext(options), id, target: options.target }));
  }
  target(options: ClipboardOptions = {}) {
    return respond(async () => ({
      address: (await activeWindow(clipboardContext(options))).address ?? "",
    }));
  }
  delete(id: string, options: ClipboardOptions = {}) {
    return respond(() => history.remove({ context: clipboardContext(options), id }));
  }
  /** Clear saved history only; the current clipboard is unchanged. */
  clear(options: ClipboardOptions = {}) {
    return respond(async () => {
      await command({ context: clipboardContext(options), args: ["cliphist", "wipe"] });
      return { cleared: true };
    });
  }
}

export const clipboard = new Clipboard();
