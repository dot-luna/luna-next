import { afterEach, beforeEach, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { gtkCss } from "../src/theme/gtk-css.ts";
import { resolveTheme } from "../src/theme/values.ts";
import { ThemeFixture } from "./fixtures/theme-fixture.ts";

const python = Bun.which("python3");
const available = Boolean(
  python &&
  (Bun.env.WAYLAND_DISPLAY || Bun.env.DISPLAY) &&
  Bun.spawnSync([python, "-c", 'import gi; gi.require_version("Gtk", "3.0")'], {
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode === 0,
);
let f: ThemeFixture;
beforeEach(() => {
  f = new ThemeFixture();
});
afterEach(() => f.dispose());

interface Style {
  foreground: string;
  background: string;
  alpha: number;
  image: boolean;
  radius: number;
}

test.skipIf(!available).each(["dark", "light"] as const)(
  "native GTK3 %s circular and popover controls use Luna colors in every tested state",
  (mode) => {
    const theme = resolveTheme(
      {
        colors: {
          mode,
          foreground: "#223344",
          lighter_background: "#e0d0c0",
          selection: "#a04020",
          selection_foreground: "#faf0e0",
          dark_foreground: "#667788",
        },
        appearance: { rounding: 17 },
      },
      "native",
    );
    const path = join(f.root, "gtk.css");
    f.write(path, gtkCss(theme, mode));
    const child = Bun.spawnSync(
      [python!, resolve(import.meta.dir, "fixtures/gtk-style-probe.py"), path],
      {
        env: {
          ...Bun.env,
          HOME: f.home,
          XDG_CONFIG_HOME: join(f.home, ".config"),
          XDG_DATA_HOME: join(f.home, ".local/share"),
          XDG_CACHE_HOME: join(f.home, ".cache"),
          GSETTINGS_BACKEND: "memory",
          GTK_THEME: "Adwaita",
          GTK_USE_PORTAL: "0",
          NO_AT_BRIDGE: "1",
          GIO_USE_VFS: "local",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    const result = JSON.parse(child.stdout.toString()) as Record<string, Record<string, Style>>;
    expect(result.circular!.normal).toMatchObject({
      foreground: "#223344",
      background: "#e0d0c0",
      image: false,
      radius: 9999,
    });
    expect(result.circular!.hover).toMatchObject({
      foreground: "#faf0e0",
      background: "#a04020",
      image: false,
      radius: 9999,
    });
    for (const name of ["model", "legacy"]) {
      const styles = result[name]!;
      expect(styles.normal).toMatchObject({ foreground: "#223344", alpha: 0, image: false });
      for (const state of ["hover", "hover_backdrop", "selected_backdrop"])
        expect(styles[state], `${name} ${state}`).toMatchObject({
          foreground: "#faf0e0",
          background: "#a04020",
          image: false,
        });
      expect(styles.disabled_selected_backdrop).toMatchObject({ foreground: "#667788" });
    }
  },
);
