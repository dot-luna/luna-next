import source from "./data/emoji.jsonc" with { type: "text" };
import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import { emojiCatalogSchema, emojiSelectionSchema } from "./schema.ts";

// Embed licensed data in the compiled CLI so search works offline without a checkout.
const entries = validate(emojiCatalogSchema, Bun.JSONC.parse(source), "Emoji catalog");
const known = new Set(entries.map((entry) => entry.emoji));

class EmojiCatalog {
  /** Return copies of entries whose name, keywords or emoji contain every query word. */
  search(query: string) {
    const words = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
    return entries
      .filter((entry) => {
        const text = `${entry.name} ${entry.keywords} ${entry.emoji}`.toLocaleLowerCase();
        return words.every((word) => text.includes(word));
      })
      .map((entry) => ({ ...entry }));
  }

  /** Join catalog emoji in selection order, keeping duplicates; anything else is INVALID_ARGUMENT. */
  text(values: string[]) {
    const parsed = emojiSelectionSchema.safeParse(values);
    if (!parsed.success || parsed.data.some((value) => !known.has(value)))
      throw new ApiError("INVALID_ARGUMENT", "Choose between 1 and 256 emoji from the catalog");
    return parsed.data.join("");
  }
}

export const emojiCatalog = new EmojiCatalog();
