import source from "./data/emoji.jsonc" with { type: "text" };
import { ApiError, respond } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import {
  clipboardContext,
  command,
  type ClipboardContext,
  type ClipboardOptions,
  type ClipboardPasteOptions,
} from "@/modules/clipboard/context.ts";
import { copyBytes } from "@/modules/clipboard/history.ts";
import { pasteIntoWindow, pasteTarget } from "@/modules/clipboard/paste.ts";
import { emojiCatalogSchema, emojiSelectionSchema } from "./schema.ts";

// Embed licensed data in the compiled CLI so search works offline without a checkout.
const entries = validate(emojiCatalogSchema, Bun.JSONC.parse(source), "Emoji catalog");
const known = new Set(entries.map((entry) => entry.emoji));

function selection(values: string[]) {
  const parsed = emojiSelectionSchema.safeParse(values);
  if (!parsed.success || parsed.data.some((value) => !known.has(value)))
    throw new ApiError("INVALID_ARGUMENT", "Choose between 1 and 256 emoji from the catalog");
  return parsed.data.join("");
}

async function copyText({ context, text }: { context: ClipboardContext; text: string }) {
  const data = Buffer.from(text);
  await copyBytes({ context, data, mime: "text/plain;charset=utf-8" });
  await command({ context, args: ["cliphist", "store"], input: data });
}

/** Offline Unicode search and insertion. Selection order and duplicate emoji are preserved. */
class Emoji {
  list(query = "") {
    return respond(() => {
      const words = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
      return entries
        .filter((entry) => {
          const text = `${entry.name} ${entry.keywords} ${entry.emoji}`.toLocaleLowerCase();
          return words.every((word) => text.includes(word));
        })
        .map((entry) => ({ ...entry }));
    });
  }
  copy(values: string[], options: ClipboardOptions = {}) {
    return respond(async () => {
      const text = selection(values);
      await copyText({ context: clipboardContext(options), text });
      return { text };
    });
  }
  /** Copy selected Unicode sequences, then paste only if the saved window still has focus. */
  paste(values: string[], options: ClipboardPasteOptions = {}) {
    return respond(async () => {
      const text = selection(values);
      const context = clipboardContext(options);
      const address = await pasteTarget({ context, target: options.target });
      await copyText({ context, text });
      await pasteIntoWindow({ context, address });
      return { text, target: address };
    });
  }
}

export const emoji = new Emoji();
