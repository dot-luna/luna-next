import { rm } from "node:fs/promises";
import { isAbsolute, join } from "pathe";
import { metadata, readOptional, writeFile } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import type { ThemeContext } from "./context.ts";
import { gtkCss } from "./gtk-css.ts";
import type { ResolvedTheme, ThemeMode } from "../schema.ts";

/** A planned stylesheet write: source is the file before publication, or null when absent. */
export interface PreparedGtkTheme {
  name: "Luna" | "Luna-alt";
  path: string;
  source: string | null;
  contents: string;
}

class GtkTheme {
  /**
   * Choose the GTK theme name to publish under, given the current gtk-theme GVariant literal.
   * Nothing is written; a matching active stylesheet is reused under its current name.
   */
  async prepare({
    context,
    theme,
    mode,
    current,
  }: {
    context: ThemeContext;
    theme: ResolvedTheme;
    mode: ThemeMode;
    current: string;
  }): Promise<PreparedGtkTheme> {
    const base =
      context.env.XDG_DATA_HOME ||
      (context.env.HOME ? join(context.env.HOME, ".local/share") : undefined);
    if (!base || !isAbsolute(base) || base === "/")
      throw new ApiError("INVALID_PATH", "Set an absolute XDG_DATA_HOME or HOME for GTK themes");
    const contents = gtkCss.render({ theme, mode });
    const pathFor = (name: string) => join(base, "themes", name, "gtk-3.0/gtk.css");
    const active =
      current === "'Luna'" ? "Luna" : current === "'Luna-alt'" ? "Luna-alt" : undefined;
    if (active) {
      const path = pathFor(active);
      await this._ordinary(path);
      const source = await readOptional(path);
      if (source === contents) return { name: active, path, source, contents };
    }
    // GTK reloads when its theme name changes, not when a stylesheet is rewritten.
    // Reuse two names so palette changes notify running apps without a file watcher.
    const name = active === "Luna" ? "Luna-alt" : "Luna";
    const path = pathFor(name);
    await this._ordinary(path);
    return { name, path, source: await readOptional(path), contents };
  }

  async publish(theme: PreparedGtkTheme) {
    await this._ordinary(theme.path);
    await writeFile(theme.path, theme.contents, theme.source);
  }

  /** Restore only the generated file Luna wrote; external edits and linked paths stay intact. */
  async restore(theme: PreparedGtkTheme) {
    await this._ordinary(theme.path);
    const current = await readOptional(theme.path);
    if (current === theme.source) return;
    if (current !== theme.contents)
      throw new ApiError("CONFLICT", `GTK theme changed externally: ${theme.path}`);
    if (theme.source === null) await rm(theme.path);
    else await writeFile(theme.path, theme.source, theme.contents);
  }

  /** Existing parents must be real directories and the leaf a regular file, never a link. */
  private async _ordinary(path: string) {
    let current = "";
    const parts = path.split("/").filter(Boolean);
    for (const [index, part] of parts.entries()) {
      current += "/" + part;
      const info = await metadata(current);
      if (info && (index === parts.length - 1 ? !info.isFile() : !info.isDirectory()))
        throw new ApiError("INVALID_PATH", `GTK theme exports must be ordinary paths: ${current}`);
    }
  }
}

export const gtkTheme = new GtkTheme();
