import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { Luna, type ApiResponse } from "../src/index.ts";
import { themeContext } from "../src/theme/context.ts";
import { gsettings } from "../src/theme/gsettings.ts";
import type { ThemeMode } from "../src/theme/types.ts";
import { ThemeFixture } from "./fixtures/theme-fixture.ts";

let f: ThemeFixture;
beforeEach(() => {
  f = new ThemeFixture();
});
afterEach(() => f.dispose());

function data<T>(response: ApiResponse<T>): T {
  if (!response.succes) throw new Error(response.errMessage);
  return response.data;
}

function settings(mode: string, gtk: string) {
  f.write(f.env.THEME_PREFERENCE!, mode);
  f.write(f.env.LUNA_TEST_GTK_THEME!, gtk);
}

function writes() {
  return f
    .read(f.env.THEME_LOG!)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[])
    .filter((command) => command[0] === "set");
}

const nativeCss = (name = "Luna", dataHome = join(f.home, ".local/share")) =>
  join(dataHome, "themes", name, "gtk-3.0/gtk.css");
const modes: ThemeMode[] = ["dark", "light"];

test.each(modes)(
  "selecting a %s theme repairs GTK when the system mode already matches",
  async (mode) => {
    const source = f.source("selected", `// author colors\n{"colors":{"mode":"${mode}"}}\n`);
    const original = f.read(join(source, "theme.jsonc"));
    data(await Luna.theme.install(source, f.options));
    settings(`prefer-${mode}`, "'Custom GTK'");

    const theme = data(await Luna.theme.set("selected", f.options));

    expect(theme.colors.mode).toBe(mode);
    expect(f.read(f.env.THEME_PREFERENCE!)).toBe(`prefer-${mode}`);
    expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Luna'");
    expect(f.read(nativeCss())).toContain(theme.colors.background!);
    expect(writes().map((command) => command[2])).toEqual(["gtk-theme"]);
    expect(data(await Luna.theme.current(f.options))).toBe("selected");
    expect(f.read(join(f.libraryDir, "selected/theme.jsonc"))).toBe(original);
  },
);

test.each(modes)(
  "setting %s mode repairs GTK when the system mode already matches",
  async (mode) => {
    settings(`prefer-${mode}`, "'Custom GTK'");

    expect(data(await Luna.theme.mode(mode, f.options))).toBe(mode);

    expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Luna'");
    expect(writes().map((command) => command[2])).toEqual(["gtk-theme"]);
  },
);

test.each(modes)("toggling to %s synchronizes system and GTK modes", async (mode) => {
  const before = mode === "dark" ? "light" : "dark";
  data(
    await Luna.theme.install(f.source("selected", `{"colors":{"mode":"${before}"}}`), f.options),
  );
  settings(`prefer-${before}`, "'Custom GTK'");
  f.write(f.configFile, '{"theme":{"name":"selected"}}\n');
  data(await Luna.theme.mode(before, f.options));
  const original = f.read(join(f.libraryDir, "selected/theme.jsonc"));

  expect(data(await Luna.theme.toggle(f.options))).toBe(mode);

  expect(f.read(f.env.THEME_PREFERENCE!)).toBe(`prefer-${mode}`);
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Luna-alt'");
  expect(JSON.parse(f.read(f.configFile))).toEqual({ theme: { name: "selected", mode } });
  expect(f.read(join(f.libraryDir, "selected/theme.jsonc"))).toBe(original);
  expect(data(await Luna.theme.get("colors.mode", f.options))).toBe(before);
});

test.each(modes)("synchronized %s appearance performs no GSettings writes", async (mode) => {
  data(await Luna.theme.install(f.source("selected", `{"colors":{"mode":"${mode}"}}`), f.options));
  settings(`prefer-${mode}`, "'Custom GTK'");
  data(await Luna.theme.set("selected", f.options));
  const originalWrites = writes();
  const originalFile = statSync(nativeCss());

  data(await Luna.theme.set("selected", f.options));
  data(await Luna.theme.mode(mode, f.options));

  expect(writes()).toEqual(originalWrites);
  expect(statSync(nativeCss()).ino).toBe(originalFile.ino);
  expect(statSync(nativeCss()).mtimeMs).toBe(originalFile.mtimeMs);
});

test("same-mode palette changes publish Luna colors and switch GTK's native theme", async () => {
  const original =
    '// authored palette\n{"colors":{"mode":"dark","background":"#132435","accent":"#bc4819"}}\n';
  data(await Luna.theme.install(f.source("palette", original), f.options));
  settings("prefer-dark", "'Custom GTK'");
  data(await Luna.theme.set("palette", f.options));
  const activeCss = f.read(nativeCss());
  expect(activeCss).toContain("#132435");
  expect(activeCss).toContain("#bc4819");

  const updated = original.replace("#132435", "#234567").replace("#bc4819", "#ce582a");
  const source = join(f.libraryDir, "palette/theme.jsonc");
  f.write(source, updated);
  data(await Luna.theme.set("palette", f.options));

  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Luna-alt'");
  expect(f.read(nativeCss("Luna-alt"))).toContain("#234567");
  expect(f.read(nativeCss("Luna-alt"))).toContain("#ce582a");
  expect(f.read(nativeCss())).toBe(activeCss);
  expect(f.read(source)).toBe(updated);
  expect(writes().map((command) => command[2])).toEqual(["gtk-theme", "gtk-theme"]);

  const previousWrites = writes();
  data(await Luna.theme.set("palette", f.options));
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Luna-alt'");
  expect(writes()).toEqual(previousWrites);
});

test("mode changes reuse the two native theme slots while retaining authored palette colors", async () => {
  const original =
    '// fixed author palette\n{"colors":{"background":"#132435","accent":"#bc4819"}}\n';
  data(await Luna.theme.install(f.source("palette", original), f.options));
  data(await Luna.theme.set("palette", f.options));
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Luna'");

  data(await Luna.theme.mode("light", f.options));
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Luna-alt'");
  expect(f.read(nativeCss("Luna-alt"))).toContain("#132435");
  expect(f.read(nativeCss("Luna-alt"))).toContain("#bc4819");

  data(await Luna.theme.mode("dark", f.options));
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Luna'");
  expect(f.read(join(f.libraryDir, "palette/theme.jsonc"))).toBe(original);
});

test("native GTK CSS uses the requested XDG data root and preserves unrelated settings", async () => {
  const dataHome = join(f.root, "custom-data");
  const unrelated = join(f.home, ".config/gtk-3.0/gtk.css");
  f.write(unrelated, "/* personal GTK overrides */\n");
  const options = { ...f.options, env: { ...f.env, XDG_DATA_HOME: dataHome } };

  data(await Luna.theme.mode("dark", options));

  expect(existsSync(nativeCss("Luna", dataHome))).toBe(true);
  expect(existsSync(nativeCss())).toBe(false);
  expect(f.read(unrelated)).toBe("/* personal GTK overrides */\n");
});

test("failed GTK activation restores the previous generated file bytes", async () => {
  const original = "/* previous generated source */\n";
  f.write(nativeCss(), original);
  f.write(f.configFile, "{}\n");
  settings("default", "'Custom GTK'");
  const options = {
    ...f.options,
    env: {
      ...f.env,
      LUNA_TEST_GSETTINGS_FAULT: JSON.stringify({
        operation: "set",
        key: "gtk-theme",
        save: true,
        fail: true,
      }),
    },
  };

  expect(await Luna.theme.mode("dark", options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });

  expect(f.read(nativeCss())).toBe(original);
  expect(f.read(f.configFile)).toBe("{}\n");
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("default");
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Custom GTK'");
});

test("failed activation preserves an external edit to generated GTK CSS", async () => {
  const external = "/* external native theme edit */\n";
  f.write(f.configFile, "{}\n");
  settings("default", "'Custom GTK'");
  const options = {
    ...f.options,
    env: {
      ...f.env,
      LUNA_TEST_GSETTINGS_FAULT: JSON.stringify({
        operation: "set",
        key: "gtk-theme",
        save: true,
        fail: true,
        files: { [nativeCss()]: external },
      }),
    },
  };

  expect(await Luna.theme.mode("dark", options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });

  expect(f.read(nativeCss())).toBe(external);
  expect(f.read(f.configFile)).toBe("{}\n");
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("default");
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Custom GTK'");
});

test("failed GTK rollback retains the generated stylesheet while its theme remains selected", async () => {
  f.write(f.configFile, "{}\n");
  settings("default", "'Custom GTK'");
  const options = {
    ...f.options,
    env: {
      ...f.env,
      LUNA_TEST_GSETTINGS_FAULT: JSON.stringify([
        { operation: "set", key: "gtk-theme", save: true, fail: true },
        { operation: "set", key: "gtk-theme", occurrence: 2, save: false, fail: true },
      ]),
    },
  };

  expect(await Luna.theme.mode("dark", options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });

  expect(f.read(f.configFile)).toBe("{}\n");
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("default");
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Luna'");
  expect(f.read(nativeCss()).length).toBeGreaterThan(0);
});

test("an invalid native CSS destination fails before changing settings or selection", async () => {
  mkdirSync(nativeCss(), { recursive: true });
  const original = '// retain selection\n{"theme":{"mode":"light"}}\n';
  f.write(f.configFile, original);
  settings("default", "'Custom GTK'");

  expect((await Luna.theme.mode("dark", f.options)).succes).toBe(false);

  expect(f.read(f.configFile)).toBe(original);
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("default");
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Custom GTK'");
  expect(writes()).toEqual([]);
});

test.each(["file", "directory"])(
  "native GTK CSS refuses a symlink %s destination",
  async (kind) => {
    const external = join(f.root, "outside/gtk-3.0/gtk.css");
    const original = "/* external GTK theme */\n";
    f.write(external, original);
    if (kind === "file") {
      mkdirSync(dirname(nativeCss()), { recursive: true });
      symlinkSync(external, nativeCss());
    } else {
      const slot = join(f.home, ".local/share/themes/Luna");
      mkdirSync(dirname(slot), { recursive: true });
      symlinkSync(join(f.root, "outside"), slot);
    }
    f.write(f.configFile, "{}\n");
    settings("default", "'Custom GTK'");

    expect((await Luna.theme.mode("dark", f.options)).succes).toBe(false);

    expect(f.read(external)).toBe(original);
    expect(f.read(f.configFile)).toBe("{}\n");
    expect(f.read(f.env.THEME_PREFERENCE!)).toBe("default");
    expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Custom GTK'");
    expect(writes()).toEqual([]);
  },
);

test.each([
  { behavior: "partial failure", save: true, fail: true },
  { behavior: "rejected write", save: false, fail: true },
  { behavior: "successful command without persistence", save: false, fail: false },
])("GTK $behavior restores the previous settings and exact selection", async ({ save, fail }) => {
  const original = '// keep these selection bytes\n{ "theme": {"mode":"light",}, }\n';
  const custom = '"Author\'s \\\\ theme"';
  f.write(f.configFile, original);
  settings("default", custom);
  const options = {
    ...f.options,
    env: {
      ...f.env,
      LUNA_TEST_GSETTINGS_FAULT: JSON.stringify({ operation: "set", key: "gtk-theme", save, fail }),
    },
  };

  expect(await Luna.theme.mode("dark", options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });

  expect(f.read(f.configFile)).toBe(original);
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("default");
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe(custom);
  expect(existsSync(nativeCss())).toBe(false);
  expect(writes().map((command) => command[2])).toEqual(
    save
      ? ["color-scheme", "gtk-theme", "gtk-theme", "color-scheme"]
      : ["color-scheme", "gtk-theme", "color-scheme"],
  );
});

test("rollback preserves external changes to both attempted settings and the selection", async () => {
  settings("default", "'Custom GTK'");
  f.write(f.configFile, "{}\n");
  const external = '// another writer\n{"theme":{"mode":"light"}}\n';
  const options = {
    ...f.options,
    env: {
      ...f.env,
      LUNA_TEST_GSETTINGS_FAULT: JSON.stringify({
        operation: "set",
        key: "gtk-theme",
        save: true,
        fail: true,
        external: { "color-scheme": "'prefer-light'", "gtk-theme": "'External GTK'" },
        selection: external,
      }),
    },
  };

  expect(await Luna.theme.mode("dark", options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });

  expect(f.read(f.configFile)).toBe(external);
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("prefer-light");
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'External GTK'");
  expect(writes().map((command) => command[2])).toEqual(["color-scheme", "gtk-theme"]);
});

test("rollback leaves an externally changed setting untouched when Luna never attempted it", async () => {
  settings("prefer-dark", "'Custom GTK'");
  f.write(f.configFile, "{}\n");
  const options = {
    ...f.options,
    env: {
      ...f.env,
      LUNA_TEST_GSETTINGS_FAULT: JSON.stringify({
        operation: "set",
        key: "gtk-theme",
        save: true,
        fail: true,
        external: { "color-scheme": "'prefer-light'" },
      }),
    },
  };

  expect(await Luna.theme.mode("dark", options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });

  expect(f.read(f.configFile)).toBe("{}\n");
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("prefer-light");
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Custom GTK'");
  expect(writes().map((command) => command[2])).toEqual(["gtk-theme", "gtk-theme"]);
});

test("a setting changed after preflight is preserved before any write to that setting", async () => {
  settings("default", "'Custom GTK'");
  f.write(f.configFile, "{}\n");
  const options = {
    ...f.options,
    env: {
      ...f.env,
      LUNA_TEST_GSETTINGS_FAULT: JSON.stringify({
        operation: "get",
        key: "gtk-theme",
        occurrence: 2,
        external: { "gtk-theme": "'External GTK'" },
      }),
    },
  };

  expect(await Luna.theme.mode("dark", options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });

  expect(f.read(f.configFile)).toBe("{}\n");
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("default");
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'External GTK'");
  expect(writes().map((command) => command[2])).toEqual(["color-scheme", "color-scheme"]);
});

test("a GTK preflight read failure leaves selection bytes and system preference intact", async () => {
  const original = '// leave this selection alone\n{"theme":{"mode":"light"}}\n';
  f.write(f.configFile, original);
  settings("default", "'Custom GTK'");
  const options = {
    ...f.options,
    env: {
      ...f.env,
      LUNA_TEST_GSETTINGS_FAULT: JSON.stringify({ operation: "get", key: "gtk-theme", fail: true }),
    },
  };

  expect(await Luna.theme.mode("dark", options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });

  expect(f.read(f.configFile)).toBe(original);
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("default");
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Custom GTK'");
  expect(writes()).toEqual([]);
});

test.skipIf(!Bun.which("gsettings") || !Bun.which("dbus-run-session"))(
  "headless dark and light appearance persist both keys in isolated dconf",
  async () => {
    unlinkSync(join(f.bin, "gsettings"));
    symlinkSync(Bun.which("gsettings")!, join(f.bin, "gsettings"));
    const env = {
      HOME: f.home,
      PATH: `${f.bin}:/usr/bin:/bin`,
      XDG_CONFIG_HOME: join(f.home, ".config"),
      XDG_DATA_HOME: join(f.home, ".local/share"),
      XDG_CACHE_HOME: join(f.home, ".cache"),
      GSETTINGS_BACKEND: "dconf",
    };
    const options = { ...f.options, env };
    for (const [index, mode] of modes.entries()) {
      expect(data(await Luna.theme.mode(mode, options))).toBe(mode);
      const context = themeContext(options);
      expect(await gsettings(context, ["get", "org.gnome.desktop.interface", "color-scheme"])).toBe(
        `'prefer-${mode}'`,
      );
      expect(await gsettings(context, ["get", "org.gnome.desktop.interface", "gtk-theme"])).toBe(
        index === 0 ? "'Luna'" : "'Luna-alt'",
      );
      expect(existsSync(nativeCss(index === 0 ? "Luna" : "Luna-alt", env.XDG_DATA_HOME))).toBe(
        true,
      );
    }
    expect(existsSync(join(env.XDG_CONFIG_HOME, "dconf/user"))).toBe(true);
  },
);
