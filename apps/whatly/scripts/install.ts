#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";
import { installFile, main, paths, run, safePath, state } from "./common.ts";

function files(directory: string): string[] {
  safePath(directory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    safePath(file);
    if (entry.isDirectory()) return files(file);
    if (!entry.isFile()) throw new Error("Whatly staging must contain ordinary files: " + file);
    return [file];
  });
}

/** Preserve upstream desktop metadata and actions; replace only executable tokens. */
export function desktopEntry(source: string, launcher: string): string {
  // A constant shell command lets GLib handle executable paths containing '='.
  // Desktop values are unescaped before Exec arguments, so quoting has two layers.
  const argument = (value: string) => {
    const quoted = value
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("`", "\\`")
      .replaceAll("$", "\\$")
      .replaceAll("%", "%%");
    return '"' + quoted.replaceAll("\\", "\\\\") + '"';
  };
  const command = ["/usr/bin/bash", "-c", 'exec "$@"', "luna-whatly", launcher]
    .map(argument)
    .join(" ");
  return source.replace(/^Exec=whatly(?=\s|$)/gmu, () => "Exec=" + command);
}

/** Publish the native prefix and desktop assets; never inspect or change profiles. */
export function install(): void {
  const locations = paths();
  if (!state().built) throw new Error("Whatly's build did not finish successfully.");
  const artifacts = files(locations.stage);
  const executable = path.join(locations.stage, "bin/whatly");
  const desktop = path.join(locations.stage, "share/applications/net.shakaran.whatly.desktop");
  for (const required of [
    executable,
    desktop,
    path.join(locations.stage, "share/metainfo/net.shakaran.whatly.appdata.xml"),
    path.join(locations.stage, "share/licenses/whatly/LICENSE"),
  ]) {
    if (!artifacts.includes(required))
      throw new Error("Missing Whatly installation artifact: " + required);
  }
  if (!artifacts.some((file) => file.startsWith(path.join(locations.stage, "share/icons") + "/"))) {
    throw new Error("Whatly did not install its desktop icons.");
  }
  const shared = artifacts.filter((file) => file.startsWith(locations.stage + "/share/"));
  const launcher = path.join(locations.home, ".local/bin/whatly");
  const desktopTarget = path.join(locations.dataHome, "applications/net.shakaran.whatly.desktop");
  for (const destination of [
    locations.install,
    launcher,
    desktopTarget,
    ...shared.map((file) =>
      path.join(locations.dataHome, path.relative(path.join(locations.stage, "share"), file)),
    ),
  ]) {
    safePath(destination);
  }
  fs.mkdirSync(path.dirname(locations.install), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(locations.install), ".luna-whatly-"));
  try {
    const payload = path.join(temporary, "prefix");
    fs.cpSync(locations.stage, payload, { recursive: true });
    fs.chmodSync(path.join(payload, "bin/whatly"), 0o755);
    const renderedDesktop = path.join(temporary, "whatly.desktop");
    fs.writeFileSync(renderedDesktop, desktopEntry(fs.readFileSync(desktop, "utf8"), launcher));
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    const renderedLauncher = path.join(temporary, "whatly");
    fs.writeFileSync(
      renderedLauncher,
      "#!/usr/bin/env bash\n" +
        "unset APPIMAGE APPDIR\n" +
        "exec " +
        quote(path.join(locations.install, "bin/whatly")) +
        ' "$@"\n',
    );

    // Exchange replaces a complete owned prefix without a backup or a missing-app window.
    if (fs.existsSync(locations.install)) {
      run([
        "mv",
        "--exchange",
        "--no-copy",
        "--no-target-directory",
        "--",
        payload,
        locations.install,
      ]);
    } else fs.renameSync(payload, locations.install);
    installFile(renderedLauncher, launcher, 0o755);
    for (const file of shared) {
      const target = path.join(
        locations.dataHome,
        path.relative(path.join(locations.stage, "share"), file),
      );
      installFile(file === desktop ? renderedDesktop : file, target);
    }
    safePath(path.join(locations.dataHome, "applications/mimeinfo.cache"));
    run(["update-desktop-database", path.join(locations.dataHome, "applications")]);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) main(install);
