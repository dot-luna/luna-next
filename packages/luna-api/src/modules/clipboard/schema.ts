import { z } from "zod";

export const clipboardIdSchema = z.string().regex(/^\d+$/u, "Use a clipboard history ID");
export const clipboardTargetSchema = z
  .string()
  .regex(/^0x[0-9a-f]+$/iu, "No application was focused when the menu opened");
export const clipboardWindowSchema = z.object({
  address: z.string().optional(),
  class: z.string().optional(),
});
export const clipboardLayersSchema = z.record(
  z.string(),
  z.object({
    levels: z.record(z.string(), z.array(z.object({ namespace: z.string() }))),
  }),
);

export interface ClipboardEntry {
  id: string;
  name: string;
  /** Decode visible attachments for a thumbnail or more specific type label. */
  attachment?: boolean;
}
export interface ClipboardPreview {
  id: string;
  mime: string;
  name: string;
  text: string;
  /** A data URL for images; empty for text and unsupported binary formats. */
  image: string;
}
