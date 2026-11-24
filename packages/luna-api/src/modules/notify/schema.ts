import { z } from "zod";

const color = z.union([
  z.enum(["foreground", "bright_foreground", "muted", "accent", "error"]),
  z.string().regex(/^#[0-9a-fA-F]{6}$/u),
]);
const priority = z.looseObject({
  opacity: z.number().min(0.35).max(1).optional(),
  icon: z.enum(["information-circle", "notification-02", "alert-02"]).optional(),
  title_color: color.optional(),
  text_color: color.optional(),
  strip_color: color.optional(),
  strip_side: z.enum(["left", "right"]).optional(),
  strip_width: z.number().int().min(0).max(12).optional(),
});

/** Sparse JSONC stays sparse on disk; rendering defaults are merged only in memory. */
export const notifySettingsSchema = z.looseObject({
  timeout_ms: z.number().int().min(250).max(60000).optional(),
  appearance: z
    .looseObject({
      width: z.number().int().min(240).max(640).optional(),
      padding: z.number().int().min(8).max(24).optional(),
      avatar_size: z.number().int().min(24).max(64).optional(),
      body_lines: z.number().int().min(1).max(5).optional(),
      border_color: color.optional(),
      border_width: z.number().int().min(0).max(3).optional(),
      shadow_size: z.number().int().min(0).max(16).optional(),
      shadow_opacity: z.number().min(0).max(0.5).optional(),
    })
    .optional(),
  stack: z
    .looseObject({
      limit: z.number().int().min(1).max(6).optional(),
      gap: z.number().int().min(0).max(24).optional(),
      peek: z.number().int().min(0).max(16).optional(),
      inset: z.number().int().min(0).max(10).optional(),
      expand_on_hover: z.boolean().optional(),
    })
    .optional(),
  priority: z
    .looseObject({
      low: priority.optional(),
      normal: priority.optional(),
      critical: priority.optional(),
    })
    .optional(),
});
export type NotifySettings = z.infer<typeof notifySettingsSchema>;

export const notifyDefaults = {
  timeout_ms: 5000,
  appearance: {
    width: 340,
    padding: 12,
    avatar_size: 36,
    body_lines: 2,
    border_color: "muted",
    border_width: 1,
    shadow_size: 8,
    shadow_opacity: 0.24,
  },
  stack: { limit: 3, gap: 8, peek: 8, inset: 5, expand_on_hover: true },
  priority: {
    low: {
      opacity: 1,
      icon: "information-circle",
      title_color: "bright_foreground",
      text_color: "foreground",
      strip_color: "muted",
      strip_width: 0,
      strip_side: "left",
    },
    normal: {
      opacity: 1,
      icon: "notification-02",
      title_color: "bright_foreground",
      text_color: "foreground",
      strip_color: "muted",
      strip_width: 0,
      strip_side: "left",
    },
    critical: {
      opacity: 1,
      icon: "alert-02",
      title_color: "error",
      text_color: "foreground",
      strip_color: "error",
      strip_width: 4,
      strip_side: "left",
    },
  },
};

export function resolveNotifySettings(source: NotifySettings) {
  return {
    timeout_ms: source.timeout_ms ?? notifyDefaults.timeout_ms,
    appearance: { ...notifyDefaults.appearance, ...source.appearance },
    stack: { ...notifyDefaults.stack, ...source.stack },
    priority: {
      low: { ...notifyDefaults.priority.low, ...source.priority?.low },
      normal: { ...notifyDefaults.priority.normal, ...source.priority?.normal },
      critical: { ...notifyDefaults.priority.critical, ...source.priority?.critical },
    },
  };
}
