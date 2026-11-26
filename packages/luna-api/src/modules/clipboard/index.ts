import { respond } from "@/lib/response.ts";
import { clipboardContext, type ClipboardOptions, type ClipboardPasteOptions } from "./context.ts";
import { clipboardHistory } from "./history.ts";
import { clipboardPaste } from "./paste.ts";
import { clipboardWatcher } from "./watcher.ts";

/** Each call uses the supplied environment. Reading history never changes the current clipboard. */
class Clipboard {
  /** Start the session's text and image history watchers; an already running pair is reused. */
  start(options: ClipboardOptions = {}) {
    return respond(() => clipboardWatcher.start(clipboardContext.resolve(options)));
  }

  /** List history entries, in cliphist order; a missing database returns []. */
  list(options: ClipboardOptions = {}) {
    return respond(() => clipboardHistory.list(clipboardContext.resolve(options)));
  }

  /** Decode one entry into a display name, readable text or an image data URL. */
  preview(id: string, options: ClipboardOptions = {}) {
    return respond(() =>
      clipboardHistory.preview({ context: clipboardContext.resolve(options), id }),
    );
  }

  /** Copy an entry's exact bytes and move it to the top of history. */
  copy(id: string, options: ClipboardOptions = {}) {
    return respond(() => clipboardHistory.copy({ context: clipboardContext.resolve(options), id }));
  }

  /** Copy and paste into the saved target; on focus failure the copied content remains available. */
  paste(id: string, options: ClipboardPasteOptions = {}) {
    return respond(() =>
      clipboardPaste.paste({
        context: clipboardContext.resolve(options),
        id,
        target: options.target,
      }),
    );
  }

  /** Capture the focused window address before the picker opens; empty when none is focused. */
  target(options: ClipboardOptions = {}) {
    return respond(async () => ({
      address: (await clipboardPaste.activeWindow(clipboardContext.resolve(options))).address ?? "",
    }));
  }

  delete(id: string, options: ClipboardOptions = {}) {
    return respond(() =>
      clipboardHistory.remove({ context: clipboardContext.resolve(options), id }),
    );
  }

  /** Clear saved history only; the current clipboard is unchanged. */
  clear(options: ClipboardOptions = {}) {
    return respond(() => clipboardHistory.clear(clipboardContext.resolve(options)));
  }
}

export const clipboard = new Clipboard();
