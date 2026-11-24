import { writeFile } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import type { ThemeContext } from "./context.ts";
import { gsettings, type PreferenceKey } from "./gsettings.ts";
import { gtkTheme, type PreparedGtkTheme } from "./gtk.ts";
import {
  themeModeSchema,
  themeSelectionSchema,
  type ResolvedTheme,
  type ThemeMode,
} from "./schema.ts";
import { themeSelection } from "./selection.ts";

interface PreferenceChange {
  key: PreferenceKey;
  before: string;
  target: string;
}

class ThemeAppearance {
  /** An explicit desktop dark/light preference wins over the selected and theme modes. */
  async mode(context: ThemeContext): Promise<ThemeMode> {
    const value = await gsettings.get({ context, key: "color-scheme" });
    if (value === "'prefer-dark'") return "dark";
    if (value === "'prefer-light'") return "light";
    return (
      (await themeSelection.read(context)).value.theme?.mode ??
      (await themeSelection.current(context)).colors.mode
    );
  }

  /**
   * Save the selection, then publish GTK colors and the desktop mode. The caller holds the
   * selection lock. On failure, recover only writes that are still unchanged and throw
   * COMMAND_FAILED listing the original error and any recovery problems.
   */
  async save({
    context,
    mode,
    theme,
  }: {
    context: ThemeContext;
    mode: ThemeMode;
    /** Newly selected theme; omitted to change only the mode of the current selection. */
    theme?: ResolvedTheme;
  }) {
    if (!themeModeSchema.safeParse(mode).success)
      throw new ApiError("INVALID_ARGUMENT", "Theme mode must be dark or light");
    const previous = await themeSelection.read(context);
    const value = validate(
      themeSelectionSchema,
      { theme: { ...previous.value.theme, mode, ...(theme ? { name: theme.name } : {}) } },
      "Theme selection",
    );
    const resolved =
      theme ?? (await themeSelection.resolved({ context, name: previous.value.theme?.name }));
    const gtkBefore = await gsettings.get({ context, key: "gtk-theme" });
    const gtk = await gtkTheme.prepare({ context, theme: resolved, mode, current: gtkBefore });
    const next = JSON.stringify(value, null, 2) + "\n";
    const changes: PreferenceChange[] = [];
    for (const [key, target] of [
      ["color-scheme", `'prefer-${mode}'`],
      ["gtk-theme", `'${gtk.name}'`],
    ] as const) {
      const before = key === "gtk-theme" ? gtkBefore : await gsettings.get({ context, key });
      if (before !== target) changes.push({ key, before, target });
    }
    await writeFile(context.configFile, next, previous.source);
    const attempted: PreferenceChange[] = [];
    try {
      await gtkTheme.publish(gtk);
      for (const change of changes) {
        if ((await gsettings.get({ context, key: change.key })) !== change.before)
          throw new ApiError("CONFLICT", `Desktop ${change.key} preference changed externally`);
        // A failed command can still save its value, so include it in recovery before calling.
        attempted.push(change);
        await gsettings.set({ context, key: change.key, value: change.target });
      }
    } catch (error) {
      const failures = [error instanceof Error ? error.message : String(error)];
      await this._recover({ context, attempted, gtk, failures });
      try {
        await writeFile(context.configFile, previous.source, next);
      } catch (recovery) {
        failures.push(`Selection recovery: ${String(recovery)}`);
      }
      throw new ApiError("COMMAND_FAILED", failures.join("; "));
    }
  }

  /** Undo attempted desktop changes in reverse, then the GTK stylesheet, appending problems. */
  private async _recover({
    context,
    attempted,
    gtk,
    failures,
  }: {
    context: ThemeContext;
    attempted: PreferenceChange[];
    gtk: PreparedGtkTheme;
    failures: string[];
  }) {
    for (const change of attempted.reverse()) {
      try {
        const current = await gsettings.get({ context, key: change.key });
        if (current === change.target)
          await gsettings.set({ context, key: change.key, value: change.before });
        else if (current !== change.before)
          failures.push(
            `Desktop ${change.key} preference changed externally; leaving it untouched`,
          );
      } catch (recovery) {
        failures.push(`${change.key} recovery: ${String(recovery)}`);
      }
    }
    try {
      if (
        gtk.source !== gtk.contents &&
        (await gsettings.get({ context, key: "gtk-theme" })) === `'${gtk.name}'`
      )
        failures.push("GTK theme remains selected; retaining its generated stylesheet");
      else await gtkTheme.restore(gtk);
    } catch (recovery) {
      failures.push(`GTK theme recovery: ${String(recovery)}`);
    }
  }
}

export const themeAppearance = new ThemeAppearance();
