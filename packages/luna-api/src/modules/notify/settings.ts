import { readFile } from "node:fs/promises";
import { join } from "pathe";
import { readDocument } from "@/lib/files.ts";
import { validate } from "@/lib/validation.ts";
import { themeSelection } from "@/modules/theme/lib/selection.ts";
import { themeContext } from "@/modules/theme/lib/context.ts";
import { notifyDefaults, notifySettingsSchema, type NotifySettings } from "./schema.ts";
import { valueAtKey } from "@/lib/keys.ts";

export type NotifySnapshot = Awaited<ReturnType<NotifySettingsStore["snapshot"]>>;

class NotifySettingsStore {
  /** Read and validate the sparse source settings, creating an empty file when it is missing. */
  async read(context: { configFile: string }) {
    const document = await readDocument(context.configFile);
    return validate(notifySettingsSchema, document.value, context.configFile);
  }

  /**
   * Read one dot-separated key, or every source setting when key is omitted.
   * Missing keys return null; empty segments fail with INVALID_ARGUMENT.
   */
  async get({ context, key }: { context: { configFile: string }; key?: string }) {
    return valueAtKey({ value: await this.read(context), key, label: "Notification" });
  }

  /**
   * Snapshot config, theme and bundled icons before starting/replacing the renderer.
   * Named colors become the current theme's hex values; icons become tinted data URLs.
   */
  async snapshot(context: {
    configFile: string;
    shellDirectory: string;
    env: Record<string, string>;
  }) {
    const settings = this._resolve(await this.read(context));
    const theme = await themeSelection.current(themeContext.resolve({ env: context.env }));
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
      const svg = await readFile(
        join(context.shellDirectory, "icons", `${style.icon}.svg`),
        "utf8",
      );
      // Color SVG bytes once so the icons work with both native and software Qt renderers.
      const tinted = svg.replaceAll("#ffffff", style.title_color);
      priority[name] = {
        ...style,
        icon_source: `data:image/svg+xml;base64,${Buffer.from(tinted).toString("base64")}`,
      };
    }
    return { theme, settings: { ...settings, priority } };
  }

  /** Merge defaults in memory only, so source files stay sparse. */
  private _resolve(source: NotifySettings) {
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
}

export const notifySettings = new NotifySettingsStore();
