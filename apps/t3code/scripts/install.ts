#!/usr/bin/env bun
/**
 * after_build: install a completed T3 AppImage, its launcher, and one desktop entry.
 * Run with system Bun after build.ts succeeds.
 *
 * Steps:
 * 1. Require the successful build marker and exactly one regular x86_64 AppImage.
 * 2. Render concrete launcher paths, fallback theme/profile roots, and the shared desktop entry.
 * 3. Atomically replace each declared installation file, without backups.
 *
 * The AppImage lives under LUNA_GIT_APP_INSTALL_DIR/t3code. The launcher applies Luna's
 * current native theme before each start and preserves caller arguments. T3 user data
 * is untouched here. Late filesystem errors can leave earlier install files updated.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installFile, main, paths, safePath, state, withLock } from "./common.ts";

export function desktopEntry(launcher: string): string {
  // Desktop Exec values undergo general string unescaping before argument unquoting.
  const quoted = launcher
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$")
    .replaceAll("%", "%%");
  const escaped = quoted.replaceAll("\\", "\\\\");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=T3 Code",
    'Exec=/usr/bin/env "' + escaped + '" %U',
    "Icon=com.t3tools.T3Code",
    "Terminal=false",
    "NoDisplay=false",
    "Categories=Development;IDE;",
    "StartupWMClass=t3code",
    "StartupNotify=false",
    "MimeType=x-scheme-handler/t3code;",
    "",
  ].join("\n");
}

export function install(): void {
  withLock(() => {
    const locations = paths();
    if (!state().built) throw new Error("T3's build did not finish successfully.");
    const output = path.join(locations.build, "generated/artifacts");
    safePath(output);
    const artifacts = fs.readdirSync(output).filter((name) => name.endsWith("-x86_64.AppImage"));
    if (artifacts.length !== 1) throw new Error("T3 must produce exactly one x86_64 AppImage.");
    const artifact = path.join(output, artifacts[0]);
    const launcher = path.join(locations.home, ".local/bin/t3code");
    const destination = path.join(locations.install, "T3-Code.AppImage");
    const desktop = path.join(locations.dataHome, "applications/com.t3tools.T3Code.desktop");
    for (const file of [artifact, destination, launcher, desktop]) safePath(file);
    if (!fs.lstatSync(artifact).isFile()) throw new Error("T3 AppImage must be a regular file.");
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "luna-t3-menu-"));
    try {
      const entry = path.join(temporary, "com.t3tools.T3Code.desktop");
      fs.writeFileSync(entry, desktopEntry(launcher));
      installFile(artifact, destination, 0o755);
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
      const configHome = Bun.env.XDG_CONFIG_HOME || path.join(locations.home, ".config");
      const data = Bun.env.LUNA_DATA_HOME_DIR || path.join(locations.dataHome, "luna");
      const defaults = {
        XDG_CONFIG_HOME: configHome,
        XDG_DATA_HOME: locations.dataHome,
        LUNA_CONFIG_HOME_DIR: Bun.env.LUNA_CONFIG_HOME_DIR || path.join(configHome, "luna"),
        LUNA_DATA_HOME_DIR: data,
        T3CODE_HOME: Bun.env.T3CODE_HOME || path.join(locations.home, ".t3"),
      };
      const replacements: Record<string, string> = {
        LAUNCHER: quote(launcher),
        CLI: quote(path.join(locations.home, ".local/bin/luna")),
        APPIMAGE: quote(destination),
        DEFAULTS: Object.entries(defaults)
          .map(([key, value]) => `if [[ -z \${${key}:-} ]]; then export ${key}=${quote(value)}; fi`)
          .join("\n"),
      };
      const template = fs.readFileSync(path.join(import.meta.dir, "t3code"), "utf8");
      const script = template.replace(
        /@(LAUNCHER|CLI|APPIMAGE|DEFAULTS)@/gu,
        (_, key: string) => replacements[key]!,
      );
      const rendered = path.join(temporary, "t3code");
      fs.writeFileSync(rendered, script);
      installFile(rendered, launcher, 0o755);
      installFile(entry, desktop, 0o644);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
}

if (import.meta.main) main(install);
