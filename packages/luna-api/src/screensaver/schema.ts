import { z } from "zod";

/** The native idle monitor uses seconds; zero disables only screensaver activation. */
export const screensaverSettingsSchema = z.looseObject({
  idle_seconds: z.number().int().min(0).max(86400).optional(),
});
export const desktopLockSchema = z.object({ locked: z.boolean() });
export type ScreensaverSettings = z.infer<typeof screensaverSettingsSchema>;
