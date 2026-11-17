import { z } from "zod";

const shortcut = z
  .object({
    code: z
      .string()
      .regex(/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|F([1-9]|1[0-2]))$/u),
    ctrl: z.boolean(),
    alt: z.boolean(),
    shift: z.boolean(),
  })
  .refine((value) => value.ctrl || value.alt, "Use Ctrl or Alt in a shortcut");

/** Preferences contain presentation and key bindings only, never chat data. */
export const settingsSchema = z.object({
  sidebarWidth: z.number().int().min(220).max(720).nullable().default(null),
  fontSize: z.number().int().min(10).max(32).nullable().default(null),
  next: shortcut.default({ code: "ArrowDown", ctrl: true, alt: true, shift: false }),
  previous: shortcut.default({ code: "ArrowUp", ctrl: true, alt: true, shift: false }),
  numbered: z.boolean().default(true),
});
export type Settings = z.infer<typeof settingsSchema>;
export type Shortcut = Settings["next"];
export const defaults = settingsSchema.parse({});

export function readSettings(value: unknown): Settings {
  const parsed = settingsSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...defaults };
}

export function matchesShortcut(event: KeyboardEvent, binding: Shortcut): boolean {
  return (
    !event.metaKey &&
    !event.isComposing &&
    !event.repeat &&
    event.code === binding.code &&
    event.ctrlKey === binding.ctrl &&
    event.altKey === binding.alt &&
    event.shiftKey === binding.shift
  );
}

export function shortcutLabel(value: Shortcut): string {
  return [
    value.ctrl && "Ctrl",
    value.alt && "Alt",
    value.shift && "Shift",
    value.code.replace(/^(Key|Digit)/u, ""),
  ]
    .filter(Boolean)
    .join("+");
}
