import { respond } from "@/lib/response.ts";
import { clipboardTools } from "@/modules/clipboard/tools.ts";
import {
  clipboardContext,
  type ClipboardContext,
  type ClipboardOptions,
  type ClipboardPasteOptions,
} from "@/modules/clipboard/context.ts";
import { clipboardPaste } from "@/modules/clipboard/paste.ts";
import { emojiCatalog } from "./catalog.ts";

/** Offline Unicode search and insertion. Selection order and duplicate emoji are preserved. */
class Emoji {
  /** Search the bundled catalog; an empty query returns every entry. */
  list(query = "") {
    return respond(() => emojiCatalog.search(query));
  }

  /** Copy the selected emoji as one text entry and add it to clipboard history. */
  copy(values: string[], options: ClipboardOptions = {}) {
    return respond(async () => {
      const text = emojiCatalog.text(values);
      await this._copyText({ context: clipboardContext.resolve(options), text });
      return { text };
    });
  }

  /** Copy selected Unicode sequences, then paste only if the saved window still has focus. */
  paste(values: string[], options: ClipboardPasteOptions = {}) {
    return respond(async () => {
      const text = emojiCatalog.text(values);
      const context = clipboardContext.resolve(options);
      const address = await clipboardPaste.target({ context, target: options.target });
      await this._copyText({ context, text });
      await clipboardPaste.intoWindow({ context, address });
      return { text, target: address };
    });
  }

  private async _copyText({ context, text }: { context: ClipboardContext; text: string }) {
    const data = Buffer.from(text);
    await clipboardTools.copy({ context, data, mime: "text/plain;charset=utf-8" });
    await clipboardTools.run({ context, args: ["cliphist", "store"], input: data });
  }
}

export const emoji = new Emoji();
