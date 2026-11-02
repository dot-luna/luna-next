import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "pathe";
import { writeFile } from "../src/lib/files.ts";
import {
  preparePreferenceWrites,
  readCurrent,
  writePreferences,
} from "../src/defaults/preferences.ts";
import { DefaultsNativeFixture } from "./fixtures/defaults-native-fixture.ts";

let f: DefaultsNativeFixture;
beforeEach(() => {
  f = new DefaultsNativeFixture();
  f.command("xdg-terminal-exec");
});
afterEach(() => f.dispose());

test("setting an exact MIME default retains comments, associations, fallback order and CRLF", async () => {
  const path = join(f.config, "mimeapps.list");
  f.write(
    path,
    [
      "# user preferences",
      "[Default Applications]",
      "image/png=old.desktop;viewer.desktop;fallback.desktop;",
      "image/jpeg=other.desktop;",
      "[Added Associations]",
      "image/png=old.desktop;",
      "[Removed Associations]",
      "# keep another removal",
      "image/png=viewer.desktop;blocked.desktop;",
      "[Other Group]",
      "custom=value",
      "",
    ].join("\r\n"),
  );
  await writePreferences(f.context(), { "image/png": "viewer.desktop" });
  expect(f.read(path)).toBe(
    [
      "# user preferences",
      "[Default Applications]",
      "image/png=viewer.desktop;old.desktop;fallback.desktop;",
      "image/jpeg=other.desktop;",
      "[Added Associations]",
      "image/png=viewer.desktop;old.desktop;",
      "[Removed Associations]",
      "# keep another removal",
      "image/png=blocked.desktop;",
      "[Other Group]",
      "custom=value",
      "",
    ].join("\r\n"),
  );
  const expected = f.read(path);
  await writePreferences(f.context(), { "image/png": "viewer.desktop" });
  expect(f.read(path)).toBe(expected);
});

test("desktop-specific overrides contain defaults only and Hyprland is configured from another desktop", async () => {
  f.env.XDG_CURRENT_DESKTOP = "KDE";
  const path = join(f.config, "kde-mimeapps.list");
  f.write(path, "# KDE preference\n[Default Applications]\napplication/pdf=old.desktop;\n");
  await writePreferences(f.context(), { "application/pdf": "viewer.desktop" });
  expect(f.read(path)).toContain("application/pdf=viewer.desktop;old.desktop;");
  expect(f.read(path)).not.toContain("[Added Associations]");
  expect(f.read(join(f.config, "hyprland-mimeapps.list"))).toBe(
    "[Default Applications]\napplication/pdf=viewer.desktop;\n",
  );
  expect(f.read(join(f.config, "mimeapps.list"))).toContain(
    "[Added Associations]\napplication/pdf=viewer.desktop;",
  );
});

test("terminal selection preserves directives and other terminals, removes selected exclusions and is idempotent", async () => {
  const path = join(f.config, "hyprland-xdg-terminals.list");
  f.write(
    path,
    "# terminal preferences\r\n/execarg_compat\r\nold.desktop\r\n-kitty.desktop\r\nkitty.desktop\r\n+other.desktop\r\n",
  );
  await writePreferences(f.context(), { terminal: "kitty.desktop" });
  expect(f.read(path)).toBe(
    "# terminal preferences\r\nkitty.desktop\r\n/execarg_compat\r\nold.desktop\r\n+other.desktop\r\n",
  );
  expect(f.read(join(f.config, "xdg-terminals.list"))).toBe("kitty.desktop\n");
  const expected = f.read(path);
  await writePreferences(f.context(), { terminal: "kitty.desktop" });
  expect(f.read(path)).toBe(expected);
  expect(f.read(join(f.config, "xdg-terminals.list"))).toBe("kitty.desktop\n");
});

test("planning resolves symlink destinations before reading snapshots and rejects checkout targets before any writes", async () => {
  const target = join(f.root, "personal/mimeapps.list");
  f.write(target, "# personal\n");
  f.write(join(f.config, "placeholder"), "");
  symlinkSync(target, join(f.config, "mimeapps.list"));
  const writes = await preparePreferenceWrites(f.context(), { "image/png": "viewer.desktop" });
  expect(writes[0]).toMatchObject({ path: target, previous: "# personal\n" });
  expect(f.read(target)).toBe("# personal\n");
  symlinkSync(f.repository, join(f.config, "hyprland-mimeapps.list"));
  await expect(
    writePreferences(f.context(), { "image/png": "viewer.desktop" }),
  ).rejects.toMatchObject({ code: "INVALID_PATH" });
  expect(f.read(target)).toBe("# personal\n");
  expect(existsSync(join(f.config, "gnome-mimeapps.list"))).toBe(false);
});

test("snapshots reject external edits without overwriting them", async () => {
  const writes = await preparePreferenceWrites(f.context(), { "image/png": "viewer.desktop" });
  const first = writes[0]!;
  f.write(first.path, "# external edit\n");
  await expect(writeFile(first.path, first.contents, first.previous)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(f.read(first.path)).toBe("# external edit\n");
});

test("current values use native read-only commands and missing values remain null", async () => {
  f.command(
    "xdg-terminal-exec",
    '[ "$XTE_CACHE_ENABLED" = 0 ] || exit 98\n[ "$1" = --print-id ] || exit 99\nprintf "kitty.desktop\\n"',
  );
  f.command("xdg-mime", 'case "$3" in image/png) printf "viewer.desktop\\n";; *) exit 1;; esac');
  expect(await readCurrent(f.context(), ["terminal", "shell", "image/png", "image/jpeg"])).toEqual({
    terminal: "kitty.desktop",
    "image/png": "viewer.desktop",
    "image/jpeg": null,
  });
});

test("invalid desktop names and missing terminal selector fail before preference writes", async () => {
  f.env.XDG_CURRENT_DESKTOP = "../other";
  await expect(
    writePreferences(f.context(), { "image/png": "viewer.desktop" }),
  ).rejects.toMatchObject({ code: "INVALID_ENVIRONMENT" });
  f.env.XDG_CURRENT_DESKTOP = "Hyprland";
  f.env.PATH = join(f.root, "missing-bin");
  await expect(writePreferences(f.context(), { terminal: "kitty.desktop" })).rejects.toMatchObject({
    code: "INVALID_ENVIRONMENT",
  });
  expect(existsSync(f.config)).toBe(false);
});
