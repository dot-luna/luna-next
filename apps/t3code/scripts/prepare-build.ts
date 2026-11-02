#!/usr/bin/env bun
/**
 * before_build: prepare an isolated T3 workspace from the already-selected Git clone.
 * Run with system Bun after Luna supplies LUNA_PACKAGE_VERSION and the Git app directories.
 *
 * Steps:
 * 1. Require a clean clone and a concrete selected ref; resolve the current Luna theme.
 * 2. Clone its exact HEAD locally into staging, keeping upstream Git metadata for the build.
 * 3. Patch the app-menu entry and add boxy CSS only when Luna resolves rounding to zero.
 * 4. Replace only this app's managed build workspace and record its revision/version.
 *
 * The source clone, installed app, and T3 user data are never edited. Repeated runs start
 * from pristine sources; an existing directory without our build marker is not removed.
 * Dependencies: system Bun, Git, and Luna. No application project or npm dependencies.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { main, paths, run, safePath, withLock } from "./common.ts";

function replaceOnce(source: string, previous: string, next: string, file: string): string {
  const first = source.indexOf(previous);
  if (first < 0 || source.indexOf(previous, first + previous.length) >= 0) {
    throw new Error("Upstream T3 source changed: expected one " + JSON.stringify(previous) + " in " + file);
  }
  return source.slice(0, first) + next + source.slice(first + previous.length);
}

export function prepare(): void {
  withLock(() => {
    const locations = paths();
    const version = Bun.env.LUNA_PACKAGE_VERSION;
    if (!version || version === "latest" || /[\x00-\x1f\x7f]/u.test(version)) {
      throw new Error("LUNA_PACKAGE_VERSION must contain Luna's selected concrete Git ref.");
    }
    for (const directory of [locations.clone, locations.build, locations.metadata]) safePath(directory);
    const git = (...args: string[]) => run(["git", "-C", locations.clone, ...args], undefined, true);
    if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("T3's selected clone has tracked changes.");
    const revision = git("rev-parse", "HEAD");
    const response = JSON.parse(run(["luna", "theme", "get", "--json"], undefined, true));
    if (response.succes !== true || typeof response.data?.appearance?.rounding !== "number") {
      throw new Error("Luna could not resolve theme rounding.");
    }
    const square = response.data.appearance.rounding === 0;
    if (fs.existsSync(locations.build) && !fs.existsSync(locations.metadata)) {
      throw new Error("Refusing to replace an unmanaged T3 build directory: " + locations.build);
    }
    const stage = fs.mkdtempSync(path.join(path.dirname(locations.build), ".t3-prepare-"));
    try {
      const workspace = path.join(stage, "checkout");
      run(["git", "clone", "--local", "--no-hardlinks", "--no-checkout", "--", locations.clone, workspace]);
      run(["git", "-C", workspace, "checkout", "--detach", revision]);
      run(["git", "-C", workspace, "remote", "set-url", "origin", git("remote", "get-url", "origin")]);
      const desktop = path.join(workspace, "apps/desktop/src/app/DesktopLinuxUrlHandler.ts");
      safePath(desktop);
      let source = fs.readFileSync(desktop, "utf8");
      source = replaceOnce(source,
        "// The AppImage integration entry owns the window identity. This\n// hidden URL-only entry must not compete with it for StartupWMClass matching.",
        "// The installed desktop entry serves both the app menu and URL handling.", desktop);
      source = replaceOnce(source, '    "NoDisplay=true",',
        '    "NoDisplay=false",\n    "Categories=Development;IDE;",\n    "StartupWMClass=t3code",', desktop);
      if (square) {
        const css = path.join(workspace, "apps/web/src/index.css");
        safePath(css);
        const boxy = fs.readFileSync(new URL("../config/boxy.css", import.meta.url), "utf8");
        if (!boxy.trim()) throw new Error("T3 boxy CSS must not be empty.");
        fs.appendFileSync(css, "\n\n/* Luna square controls. */\n" + boxy.trim() + "\n");
      }
      fs.writeFileSync(desktop, source);
      fs.writeFileSync(path.join(workspace, ".luna-build.json"),
        JSON.stringify({ version, revision, square, built: false }, null, 2) + "\n");
      if (fs.existsSync(locations.build)) fs.rmSync(locations.build, { recursive: true });
      fs.renameSync(workspace, locations.build);
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  });
}

if (import.meta.main) main(prepare);
