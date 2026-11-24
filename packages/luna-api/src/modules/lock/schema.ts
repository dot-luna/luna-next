import { z } from "zod";

/** Durations are seconds. Zero disables the corresponding timer independently. */
export const lockSettingsSchema = z.looseObject({
  idle_seconds: z.number().int().min(0).max(86400).optional(),
  dpms_seconds: z.number().int().min(0).max(86400).optional(),
});
export type LockSettings = z.infer<typeof lockSettingsSchema>;
