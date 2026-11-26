import { z } from "zod";
import { hasControlCharacters } from "@/lib/paths.ts";

/** A bundled icon name from the bar's icons/ directory, or an absolute SVG path. */
const icon = z.union([
  z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  z
    .string()
    .regex(/^\/.*\.svg$/u)
    .refine((path) => !hasControlCharacters(path), "Icon paths cannot contain control characters"),
]);

const format = z.string().min(1).max(64);

/** Sparse JSONC stays sparse on disk; rendering defaults are merged only in memory. */
export const barSettingsSchema = z.looseObject({
  workspaces: z
    .looseObject({
      /** Workspace slots shown at once; the strip scrolls to keep the selection visible. */
      visible: z.number().int().min(1).max(10).optional(),
      /** Icons shown for the active workspace, keyed by workspace ID (10 is Super+0). */
      icons: z.record(z.string().regex(/^[1-9][0-9]*$/u), icon).optional(),
    })
    .optional(),
  clock: z
    .looseObject({
      /** Qt date/time format for the bar, such as "ddd d MMM  HH:mm". */
      format: format.optional(),
      /** Qt time format for the calendar's clocks. */
      time_format: format.optional(),
      /** Qt date format for the calendar's clocks. */
      date_format: format.optional(),
      /** Extra clocks beside the calendar; timezone is an IANA name such as "Europe/London". */
      world: z
        .array(
          z.strictObject({
            name: z.string().trim().min(1).max(24),
            timezone: z.string().min(1).max(64),
          }),
        )
        .max(8)
        .optional(),
    })
    .optional(),
  controls: z
    .looseObject({
      /** Sliders shown in the controls panel, in order. */
      sliders: z
        .array(z.enum(["output", "input", "brightness"]))
        .max(3)
        .optional(),
      /** Toggle tiles shown in the controls panel, in order. */
      tiles: z
        .array(z.enum(["network", "bluetooth", "dark_mode", "stay_awake"]))
        .max(4)
        .optional(),
      /** Show media controls for a playing or paused player. */
      media: z.boolean().optional(),
    })
    .optional(),
  tray: z
    .looseObject({
      /** Show a dropdown for system tray apps. */
      enabled: z.boolean().optional(),
    })
    .optional(),
  calendar: z
    .looseObject({
      /** Calendar shown first: "ad" (Gregorian) or "bs" (Bikram Sambat). */
      default: z.enum(["ad", "bs"]).optional(),
    })
    .optional(),
});
export type BarSettings = z.infer<typeof barSettingsSchema>;

/** Rendering defaults. Configured icon maps and world clock lists replace these, not merge. */
export const barDefaults = {
  workspaces: {
    visible: 4,
    icons: {
      "1": "code-xml",
      "2": "terminal",
      "3": "chrome",
      "8": "video-01",
      "9": "chat-01",
      "10": "bot",
    } as Record<string, string>,
  },
  clock: {
    format: "ddd d MMM  HH:mm",
    time_format: "HH:mm",
    date_format: "ddd d MMM",
    world: [
      { name: "CST", timezone: "America/Chicago" },
      { name: "EST", timezone: "America/New_York" },
      { name: "UTC", timezone: "UTC" },
    ],
  },
  controls: {
    sliders: ["output", "input", "brightness"] as ("output" | "input" | "brightness")[],
    tiles: ["network", "bluetooth", "dark_mode", "stay_awake"] as (
      | "network"
      | "bluetooth"
      | "dark_mode"
      | "stay_awake"
    )[],
    media: true,
  },
  tray: { enabled: true },
  calendar: { default: "ad" as "ad" | "bs" },
};
