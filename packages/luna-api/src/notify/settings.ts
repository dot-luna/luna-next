import { readFile } from "node:fs/promises";
import { join } from "pathe";
import { readDocument } from "../lib/files.ts";
import { validate } from "../lib/validation.ts";
import { currentTheme } from "../theme/selection.ts";
import { themeContext } from "../theme/context.ts";
import { notifySettingsSchema, resolveNotifySettings } from "./schema.ts";

export async function readNotifySettings(context: { configFile: string }) {
  const document = await readDocument(context.configFile);
  return validate(notifySettingsSchema, document.value, context.configFile);
}

/** Snapshot config, theme and bundled icons before starting/replacing the renderer. */
export async function notifySnapshot(context: {
  configFile: string;
  shellDirectory: string;
  env: Record<string, string>;
}) {
  const settings = resolveNotifySettings(await readNotifySettings(context));
  const theme = await currentTheme(themeContext({ env: context.env }));
  const colors = theme.colors as Record<string, string>;
  const resolveColor = (value: string) => (value.startsWith("#") ? value : colors[value]!);
  settings.appearance.border_color = resolveColor(settings.appearance.border_color);
  for (const style of Object.values(settings.priority)) {
    style.title_color = resolveColor(style.title_color);
    style.text_color = resolveColor(style.text_color);
    style.strip_color = resolveColor(style.strip_color);
  }
  const priority = {} as Record<
    keyof typeof settings.priority,
    typeof settings.priority.normal & { icon_source: string }
  >;
  for (const name of ["low", "normal", "critical"] as const) {
    const style = settings.priority[name];
    const svg = await readFile(join(context.shellDirectory, "icons", `${style.icon}.svg`), "utf8");
    // Color SVG bytes once so the icons work with both native and software Qt renderers.
    const tinted = svg.replaceAll("#ffffff", style.title_color);
    priority[name] = {
      ...style,
      icon_source: `data:image/svg+xml;base64,${Buffer.from(tinted).toString("base64")}`,
    };
  }
  return { theme, settings: { ...settings, priority } };
}
