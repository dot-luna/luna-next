import { join } from "pathe";
import { metadata, readDocument } from "@/lib/files.ts";
import { valueAtKey } from "@/lib/keys.ts";
import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import { barDefaults, barSettingsSchema, type BarSettings } from "./schema.ts";

class BarSettingsStore {
  /** Read and validate the sparse source settings, creating an empty file when it is missing. */
  async read(context: { configFile: string }) {
    const document = await readDocument(context.configFile);
    return validate(barSettingsSchema, document.value, context.configFile);
  }

  /** Read one dot-separated source setting, or all of them; missing keys return null. */
  async get({ context, key }: { context: { configFile: string }; key?: string }) {
    return valueAtKey({ value: await this.read(context), key, label: "Bar" });
  }

  /**
   * Resolve settings for the renderer: defaults merged in memory, and each workspace icon
   * resolved to an absolute SVG path. Unknown icons or timezones fail with INVALID_METADATA.
   */
  async snapshot(context: { configFile: string; shellDirectory: string }) {
    const source = await this.read(context);
    const settings = this._resolve(source);
    const icons: Record<string, string> = {};
    for (const [workspace, icon] of Object.entries(settings.workspaces.icons)) {
      const path = icon.startsWith("/")
        ? icon
        : join(context.shellDirectory, "icons", `${icon}.svg`);
      if (!(await metadata(path))?.isFile())
        throw new ApiError(
          "INVALID_METADATA",
          `Unknown bar icon for workspace ${workspace}: ${icon}`,
        );
      icons[workspace] = path;
    }
    for (const clock of settings.clock.world) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: clock.timezone });
      } catch {
        throw new ApiError(
          "INVALID_METADATA",
          `Unknown timezone for ${clock.name}: ${clock.timezone}`,
        );
      }
    }
    return { ...settings, workspaces: { ...settings.workspaces, icons } };
  }

  private _resolve(source: BarSettings) {
    return {
      workspaces: {
        visible: source.workspaces?.visible ?? barDefaults.workspaces.visible,
        icons: source.workspaces?.icons ?? barDefaults.workspaces.icons,
      },
      clock: {
        format: source.clock?.format ?? barDefaults.clock.format,
        time_format: source.clock?.time_format ?? barDefaults.clock.time_format,
        date_format: source.clock?.date_format ?? barDefaults.clock.date_format,
        world: source.clock?.world ?? barDefaults.clock.world,
      },
      calendar: { default: source.calendar?.default ?? barDefaults.calendar.default },
    };
  }
}

export const barSettings = new BarSettingsStore();
