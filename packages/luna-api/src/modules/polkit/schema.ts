import { z } from "zod";

/** Source settings stay sparse; defaults apply only to the renderer snapshot. */
export const polkitSettingsSchema = z.looseObject({
  width: z.number().int().min(280).max(640).optional(),
  dim_opacity: z.number().min(0).max(0.8).optional(),
});
export type PolkitSettings = z.infer<typeof polkitSettingsSchema>;
export const polkitDefaults = { width: 420, dim_opacity: 0.5 };
