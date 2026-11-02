import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ApiResponse, ResolvedTheme } from "../src/index.ts";
import { themeContext } from "../src/theme/context.ts";
import { gsettings } from "../src/theme/gsettings.ts";
import { ThemeFixture } from "./fixtures/theme-fixture.ts";

let f: ThemeFixture;
let invocation = 0;
const entry = resolve(import.meta.dir, "../../../src/luna-cli/src/index.ts");
beforeEach(() => {
  f = new ThemeFixture();
  invocation = 0;
});
afterEach(() => f.dispose());

async function cli<T>(env: Record<string, string>, args: string[]): Promise<T> {
  const output = join(f.root, `cli-${invocation++}`);
  const stdout = Bun.file(output + ".stdout");
  const stderr = Bun.file(output + ".stderr");
  const child = Bun.spawn(
    [
      process.execPath,
      entry,
      "theme",
      "--config-file",
      f.configFile,
      "--library-dir",
      f.libraryDir,
      ...args,
      "--json",
    ],
    { env, stdin: "ignore", stdout, stderr },
  );
  const status = await child.exited;
  const text = await stdout.text();
  expect(status, text + (await stderr.text())).toBe(0);
  const response = JSON.parse(text) as ApiResponse<T>;
  if (!response.succes) throw new Error(response.errMessage);
  return response.data;
}

test
  .skipIf(!Bun.which("gsettings") || !Bun.which("dbus-run-session"))
  .each(["dark", "light"] as const)(
  "%s GTK colors, fonts, rounding and selection survive fresh CLI and D-Bus sessions",
  async (mode) => {
    // No inherited desktop bus, runtime directory, GTK override or mocked commands.
    const env = {
      HOME: f.home,
      PATH: "/usr/bin:/bin",
      XDG_CONFIG_HOME: join(f.home, ".config"),
      XDG_DATA_HOME: join(f.home, ".local/share"),
      XDG_CACHE_HOME: join(f.home, ".cache"),
      XDG_STATE_HOME: join(f.home, ".local/state"),
      GSETTINGS_BACKEND: "dconf",
    };
    const source = f.source(
      "persistent",
      `// Preserve author formatting and comments.\n{
  "colors": { "mode": "${mode}", "background": "#172635", "accent": "#c78645" },
  "fonts": { "ui": "Persistent UI", "mono": "Persistent Mono" },
  "appearance": { "rounding": 17 },
}\n`,
    );
    const authored = f.read(join(source, "theme.jsonc"));
    await cli(env, ["install", source]);
    await cli(env, ["set", "persistent"]);

    const cssPath = join(env.XDG_DATA_HOME, "themes/Luna/gtk-3.0/gtk.css");
    const stylesheet = f.read(cssPath);
    const selection = f.read(f.configFile);
    expect(existsSync(join(env.XDG_CONFIG_HOME, "dconf/user"))).toBe(true);

    // Each helper starts a new process and private bus, reading the saved dconf database.
    const context = themeContext({ ...f.options, env });
    expect(await gsettings(context, ["get", "org.gnome.desktop.interface", "color-scheme"])).toBe(
      `'prefer-${mode}'`,
    );
    const nativeName = await gsettings(context, [
      "get",
      "org.gnome.desktop.interface",
      "gtk-theme",
    ]);
    expect(nativeName).toBe("'Luna'");
    expect(join(env.XDG_DATA_HOME, "themes", nativeName.slice(1, -1), "gtk-3.0/gtk.css")).toBe(
      cssPath,
    );

    expect(await cli(env, ["current"])).toBe("persistent");
    expect(await cli(env, ["mode"])).toBe(mode);
    const theme = await cli<ResolvedTheme>(env, ["get"]);
    expect(theme.colors).toMatchObject({ mode, background: "#172635", accent: "#c78645" });
    expect(theme.fonts).toEqual({ ui: "Persistent UI", mono: "Persistent Mono" });
    expect(theme.appearance.rounding).toBe(17);
    for (const value of ["#172635", "#c78645", ...Object.values(theme.fonts)])
      expect(stylesheet).toContain(value);
    expect(stylesheet).toMatch(/border-radius:\s*17px/u);
    expect(f.read(cssPath)).toBe(stylesheet);
    expect(f.read(f.configFile)).toBe(selection);
    expect(f.read(join(source, "theme.jsonc"))).toBe(authored);
    expect(f.read(join(f.libraryDir, "persistent/theme.jsonc"))).toBe(authored);
  },
);
