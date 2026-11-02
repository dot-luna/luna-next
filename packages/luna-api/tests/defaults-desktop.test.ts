import { afterEach, beforeEach, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "pathe";
import { desktopArgument } from "../src/lib/desktop.ts";
import { desktopEntries } from "../src/defaults/desktop.ts";
import { DefaultsNativeFixture } from "./fixtures/defaults-native-fixture.ts";

let f: DefaultsNativeFixture;
beforeEach(() => {
  f = new DefaultsNativeFixture();
  f.command("viewer", "exit 99");
});
afterEach(() => f.dispose());

test("desktop IDs use XDG priority and nested paths; overrides mask usable system copies", async () => {
  f.entry("vendor/viewer.desktop", "MimeType=image/png;image/jpeg;\n");
  f.entry("hidden.desktop", "Hidden=true\n");
  f.entry("hidden.desktop", "MimeType=image/png;\n", f.systemData);
  f.entry("missing.desktop", "TryExec=not-installed\n");
  f.entry("missing.desktop", "MimeType=image/png;\n", f.systemData);
  f.write(join(f.data, "applications/invalid.desktop"), "[Desktop Entry]\nType=Link\nName=Bad\n");
  f.entry("invalid.desktop", "", f.systemData);
  symlinkSync(join(f.root, "removed.desktop"), join(f.data, "applications/broken.desktop"));
  f.entry("broken.desktop", "", f.systemData);
  const entries = await desktopEntries(f.context());
  expect(entries.get("vendor-viewer.desktop")).toMatchObject({
    id: "vendor-viewer.desktop",
    mimeTypes: ["image/png", "image/jpeg"],
    available: true,
    terminal: false,
  });
  for (const id of ["hidden.desktop", "missing.desktop", "invalid.desktop", "broken.desktop"])
    expect(entries.get(id)?.available).toBe(false);
});

test("terminal emulators use their category; NoDisplay and visibility hints do not forbid explicit selection", async () => {
  f.entry(
    "terminal.desktop",
    "Categories=System;TerminalEmulator;\nX-TerminalArgExec=--\nNoDisplay=true\nOnlyShowIn=KDE;\n",
  );
  f.entry("terminal-app.desktop", "Terminal=true\n");
  f.entry("compat-only.desktop", "Categories=TerminalEmulator;\n");
  f.entry("empty-argument.desktop", "Categories=TerminalEmulator;\nX-TerminalArgExec=\n");
  f.entry("standard-argument.desktop", "Categories=TerminalEmulator;\nTerminalArgExec=--\n");
  const entries = await desktopEntries(f.context());
  expect(entries.get("terminal.desktop")).toMatchObject({ terminal: true, available: true });
  expect(entries.get("terminal-app.desktop")).toMatchObject({ terminal: false, available: true });
  expect(entries.get("compat-only.desktop")?.terminal).toBe(false);
  expect(entries.get("empty-argument.desktop")?.terminal).toBe(true);
  expect(entries.get("standard-argument.desktop")?.terminal).toBe(true);
});

test("Exec unescapes desktop strings and complete quoted arguments without running applications", async () => {
  const binary = join(f.bin, 'viewer "quote" $value `literal` \\ 100%');
  f.write(binary, `#!${Bun.which("sh")}\nexit 99\n`, true);
  f.write(
    join(f.data, "applications/quoted.desktop"),
    `[Desktop Entry]\nType=Application\nName=Quoted\\sViewer\nExec=${desktopArgument(binary)} %f\n`,
  );
  expect((await desktopEntries(f.context())).get("quoted.desktop")).toMatchObject({
    name: "Quoted Viewer",
    available: true,
  });
});

test.each([
  "viewer;touch marker",
  '"viewer"suffix %f',
  '"viewer %f',
  "viewer %Z",
  "viewer %f %U",
  'viewer "%f"',
  "viewer --files=%U",
  "viewer\\q %f",
  "missing-viewer %f",
])("malformed or unavailable Exec is not selectable: %s", async (exec) => {
  f.write(
    join(f.data, "applications/invalid.desktop"),
    `[Desktop Entry]\nType=Application\nName=Bad\nExec=${exec}\n`,
  );
  expect((await desktopEntries(f.context())).get("invalid.desktop")?.available).toBe(false);
});

test("D-Bus activation does not require Exec, while TryExec must name an installed executable", async () => {
  f.write(
    join(f.data, "applications/dbus.desktop"),
    "[Desktop Entry]\nType=Application\nName=Activated\nDBusActivatable=true\n",
  );
  f.entry("tryexec.desktop", "TryExec=viewer\n");
  f.entry("not-executable.desktop", "TryExec=ordinary-file\n");
  f.write(join(f.bin, "ordinary-file"), "text");
  const entries = await desktopEntries(f.context());
  expect(entries.get("dbus.desktop")?.available).toBe(true);
  expect(entries.get("tryexec.desktop")?.available).toBe(true);
  expect(entries.get("not-executable.desktop")?.available).toBe(false);
});

test("relative XDG data paths are ignored rather than resolving under the caller cwd", async () => {
  f.env.XDG_DATA_HOME = "relative-data";
  f.env.XDG_DATA_DIRS = `relative-system:${f.systemData}`;
  f.entry("home.desktop", "", join(f.home, ".local/share"));
  f.entry("system.desktop", "", f.systemData);
  expect([...(await desktopEntries(f.context())).keys()]).toEqual([
    "home.desktop",
    "system.desktop",
  ]);
});
