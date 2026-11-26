import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../src/main.ts", import.meta.url));

async function fixture(root: string) {
  const config = join(root, "config");
  const data = join(root, "data");
  const bin = join(root, "bin");
  const theme = join(data, "themes", "custom");
  await Promise.all([mkdir(config), mkdir(theme, { recursive: true }), mkdir(bin)]);
  await writeFile(join(config, "theme.jsonc"), '{"theme":{"name":"custom"}}');
  const source =
    '// Preserve the authored source.\n{"colors":{"accent":"#dd8855"},"fonts":{"ui":"serif"},"appearance":{"rounding":17,"border_width":2}}\n';
  await writeFile(join(theme, "theme.jsonc"), source);
  const executable = join(bin, "qs");
  await writeFile(
    executable,
    '#!/bin/sh\nprintf "%s" "$LUNA_SETTINGS_THEME" > "$LUNA_SETTINGS_CAPTURE"\nprintf "%s\\n" "$@" > "$LUNA_SETTINGS_ARGS"\nprintf "%s" "$QML_IMPORT_PATH" > "$LUNA_SETTINGS_IMPORTS"\nprintf "%s" "$LUNA_SETTINGS_BACKGROUND_COMMAND" > "$LUNA_SETTINGS_BRIDGE"\nprintf "%s" "$QT_QPA_PLATFORMTHEME" > "$LUNA_SETTINGS_PLATFORM"\nexit 23\n',
  );
  await chmod(executable, 0o755);
  return {
    source,
    sourceFile: join(theme, "theme.jsonc"),
    executable,
    env: {
      ...Bun.env,
      HOME: root,
      PATH: bin,
      LUNA_CONFIG_HOME_DIR: config,
      LUNA_DATA_HOME_DIR: data,
      LUNA_SETTINGS_CAPTURE: join(root, "capture.json"),
      LUNA_SETTINGS_ARGS: join(root, "args.txt"),
      LUNA_SETTINGS_IMPORTS: join(root, "imports.txt"),
      LUNA_SETTINGS_BRIDGE: join(root, "bridge.json"),
      LUNA_SETTINGS_PLATFORM: join(root, "platform.txt"),
      QML_IMPORT_PATH: join(root, "existing-qml"),
    },
  };
}

test("launcher passes one resolved theme snapshot and leaves its source intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "luna-settings-theme-"));
  try {
    const setup = await fixture(root);
    const child = Bun.spawn([process.execPath, entry], {
      env: setup.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(23);
    expect(await new Response(child.stderr).text()).toBe("");
    const snapshot = JSON.parse(await readFile(setup.env.LUNA_SETTINGS_CAPTURE, "utf8"));
    expect(snapshot.name).toBe("custom");
    expect(snapshot.colors.accent).toBe("#dd8855");
    expect(snapshot.colors.background).toBe("#1a1b26");
    expect(snapshot.fonts.ui).toBe("serif");
    expect(snapshot.appearance.rounding).toBe(17);
    expect(snapshot.appearance.border_width).toBe(2);
    expect(snapshot.appearance.opacity.active).toBe(0.9);
    expect(await readFile(setup.sourceFile, "utf8")).toBe(setup.source);
    expect(await readFile(setup.env.LUNA_SETTINGS_ARGS, "utf8")).toBe(
      `-p\n${fileURLToPath(new URL("../src/shell", import.meta.url))}\n`,
    );
    expect(await readFile(setup.env.LUNA_SETTINGS_PLATFORM, "utf8")).toBe("xdgdesktopportal");
    expect(JSON.parse(await readFile(setup.env.LUNA_SETTINGS_BRIDGE, "utf8"))).toEqual([
      process.execPath,
      fileURLToPath(new URL("../src/backgrounds.ts", import.meta.url)),
    ]);
    expect(await readFile(setup.env.LUNA_SETTINGS_IMPORTS, "utf8")).toBe(
      [
        fileURLToPath(new URL("../../../packages/luna-ui/src", import.meta.url)),
        setup.env.QML_IMPORT_PATH,
      ].join(delimiter),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("launcher reports an invalid theme before opening Quickshell", async () => {
  const root = await mkdtemp(join(tmpdir(), "luna-settings-theme-"));
  try {
    const setup = await fixture(root);
    await writeFile(setup.sourceFile, '{"appearance":{"rounding":-1}}');
    const child = Bun.spawn([process.execPath, entry], {
      env: setup.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("rounding");
    expect(await Bun.file(setup.env.LUNA_SETTINGS_CAPTURE).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("launcher explains when Quickshell is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "luna-settings-theme-"));
  try {
    const setup = await fixture(root);
    await rm(setup.executable);
    const child = Bun.spawn([process.execPath, entry], {
      env: setup.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("Install Quickshell");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
