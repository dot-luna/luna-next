import { readdir } from "node:fs/promises";
import { join } from "pathe";
import { metadata, readOptional } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import type { LoginContext, LoginState } from "./context.ts";

class LoginSddm {
  // Append last in SDDM's highest-priority file, retaining unrelated native settings.
  readonly activation =
    "\n# BEGIN LUNA LOGIN\n[Theme]\nCurrent=luna\nThemeDir=/usr/share/sddm/themes\n# END LUNA LOGIN\n";

  withoutActivation(source: string) {
    const rest = source.replace(this.activation, "");
    if (rest.includes("# BEGIN LUNA LOGIN") || rest.includes("# END LUNA LOGIN"))
      throw new ApiError(
        "CONFLICT",
        "Luna's SDDM activation block was edited or duplicated; resolve it before installing or uninstalling",
      );
    return rest;
  }

  /** Match SDDM's case-sensitive, last-assignment-wins parser, including inline # comments. */
  private _readTheme(source: string, theme: { Current: string; ThemeDir: string }) {
    let section = "General";
    for (const raw of source.split(/\r?\n/u)) {
      const line = raw.split("#", 1)[0]!.trim();
      const separator = line.indexOf("=");
      if (separator >= 0) {
        const key = line.slice(0, separator).trim();
        if (section === "Theme" && (key === "Current" || key === "ThemeDir"))
          theme[key] = line.slice(separator + 1).trim();
      } else if (line.startsWith("[") && line.endsWith("]")) section = line.slice(1, -1);
    }
  }

  /** Inspect saved SDDM selection; this does not claim a running greeter has reloaded. */
  async state(context: LoginContext): Promise<LoginState> {
    const theme = { Current: "", ThemeDir: "/usr/share/sddm/themes" };
    for (const relative of ["usr/lib/sddm/sddm.conf.d", "etc/sddm.conf.d"]) {
      const directory = join(context.systemRoot, relative);
      let names: string[];
      try {
        names = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const name of names.filter((name) => !name.startsWith(".")).sort()) {
        const file = join(directory, name);
        const info = await metadata(file);
        if (info?.isDirectory()) continue;
        const source = await readOptional(file);
        if (source !== null) this._readTheme(source, theme);
      }
    }
    this._readTheme((await readOptional(context.sddmConfigFile)) ?? "", theme);
    const installed =
      (await metadata(join(context.themeDirectory, "Main.qml")))?.isFile() === true &&
      (await readOptional(join(context.themeDirectory, "metadata.desktop")))?.includes(
        "Theme-Id=luna\n",
      ) === true;
    return {
      installed,
      selected:
        installed &&
        theme.Current === "luna" &&
        theme.ThemeDir.replace(/\/+$/u, "") === "/usr/share/sddm/themes",
      configFile: context.configFile,
      themeDirectory: context.themeDirectory,
    };
  }
}
export const loginSddm = new LoginSddm();
