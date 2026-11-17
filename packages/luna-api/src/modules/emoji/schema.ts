import { z } from "zod";

export const emojiEntrySchema = z.object({
  name: z.string().min(1),
  emoji: z.string().min(1),
  keywords: z.string(),
});
export const emojiCatalogSchema = z.array(emojiEntrySchema);
export const emojiSelectionSchema = z.array(z.string().min(1)).min(1).max(256);
export type EmojiEntry = z.infer<typeof emojiEntrySchema>;
