import { z } from "zod";
import { hasControlCharacters } from "@/lib/paths.ts";

const localPath = z
  .string()
  .min(1)
  .refine((value) => !hasControlCharacters(value), {
    message: "Use a local file path without control characters",
  });

/** Durations are seconds. Zero disables the corresponding timer independently. */
export const lockSettingsSchema = z.looseObject({
  // Paths resolve from the settings directory; the screen folder contains Screen.qml.
  screen: z.strictObject({ path: localPath.optional() }).optional(),
  background: z.strictObject({ path: localPath.optional() }).optional(),
  actions: z
    .strictObject({ shutdown_delay: z.number().int().min(0).max(2_147_483_647).optional() })
    .optional(),
  idle_seconds: z.number().int().min(0).max(86400).optional(),
  dpms_seconds: z.number().int().min(0).max(86400).optional(),
});
export type LockSettings = z.infer<typeof lockSettingsSchema>;
