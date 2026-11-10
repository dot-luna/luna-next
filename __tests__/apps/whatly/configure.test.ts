import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaults, lightColors } from "../../../packages/luna-api/src/theme/defaults.ts";
import { settings } from "../../../apps/whatly/src/configure.ts";

const hook = resolve(import.meta.dir, "../../../apps/whatly/scripts/configure.ts");
const useragent =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const nativeRoot = mkdtempSync(join(tmpdir(), "luna-whatly-native-"));
const inspector = join(nativeRoot, "appearance");

beforeAll(() => {
  const flags = Bun.spawnSync(["pkg-config", "--cflags", "--libs", "Qt6WebEngineWidgets"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(flags.exitCode, flags.stderr.toString()).toBe(0);
  const build = Bun.spawnSync(
    [
      "c++",
      "-std=c++17",
      "-fPIC",
      join(import.meta.dir, "fixtures/appearance.cpp"),
      "-o",
      inspector,
      ...flags.stdout.toString().trim().split(/\s+/u),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(build.exitCode, build.stderr.toString()).toBe(0);
}, 30_000);
afterAll(() => rmSync(nativeRoot, { recursive: true, force: true }));

function fixture(xdg = true) {
  const root = mkdtempSync(join(tmpdir(), "luna-whatly config ' $ "));
  const home = join(root, "home");
  const configHome = xdg ? join(root, "config") : join(home, ".config");
  const dataHome = xdg ? join(root, "data") : join(home, ".local/share");
  const native = join(configHome, "shakaran/whatly.conf");
  const css = join(dataHome, "shakaran/whatly/custom.css");
  const theme = structuredClone(defaults);
  const write = (file: string, contents: string, mode = 0o600) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents, { mode });
  };
  write(join(root, "theme.json"), JSON.stringify({ succes: true, data: theme }));
  write(
    join(root, "bin/luna"),
    `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
appendFileSync(Bun.env.TEST_COMMANDS!, JSON.stringify(Bun.argv.slice(2)) + "\\n");
if (Bun.env.TEST_EDIT) writeFileSync(Bun.env.TEST_EDIT, "external edit\\n");
if (Bun.env.TEST_FAIL) process.exit(1);
console.log(readFileSync(Bun.env.TEST_THEME!, "utf8"));
`,
    0o755,
  );
  const env = {
    HOME: home,
    PATH: join(root, "bin") + ":" + Bun.env.PATH,
    ...(xdg ? { XDG_CONFIG_HOME: configHome, XDG_DATA_HOME: dataHome } : {}),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_RUNTIME_DIR: join(root, "runtime"),
    QT_QPA_PLATFORM: "offscreen",
    QTWEBENGINE_CHROMIUM_FLAGS: "--disable-gpu",
    TEST_COMMANDS: join(root, "commands.jsonl"),
    TEST_THEME: join(root, "theme.json"),
  };
  mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
  const run = (extra: Record<string, string> = {}) =>
    Bun.spawnSync([process.execPath, hook], {
      env: { ...env, ...extra },
      stdout: "pipe",
      stderr: "pipe",
    });
  const inspect = () => {
    const result = Bun.spawnSync([inspector, css], {
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return JSON.parse(result.stdout.toString());
  };
  const saveTheme = () => write(env.TEST_THEME, JSON.stringify({ succes: true, data: theme }));
  return {
    root,
    home,
    configHome,
    dataHome,
    native,
    css,
    theme,
    write,
    env,
    run,
    inspect,
    saveTheme,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("Whatly applies native defaults and web colors without changing accounts or shortcuts", () => {
  const f = fixture();
  try {
    const other =
      "trayIcon=true\n\n[accounts]\nitems=@ByteArray(opaque)\n\n[shortcuts]\nfindChat=Alt+F\n";
    f.write(f.native, "[General]\nuseragent=old\nchatTheme=rose\nwindowTheme=light\n" + other);
    chmodSync(f.native, 0o640);
    f.write(f.css, "old stylesheet");
    const session = join(f.dataHome, "shakaran/whatly/QtWebEngine/session");
    const named = join(f.configHome, "shakaran/whatly-work.conf");
    f.write(session, "session");
    f.write(named, "named account");
    const result = f.run();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const native = readFileSync(f.native, "utf8");
    expect(native).toContain(other);
    expect(native).toContain("chatTheme=none\n");
    expect(native).toContain("followSystemTheme=false\n");
    expect(native).toContain("automaticTheme=false\n");
    expect(statSync(f.native).mode & 0o777).toBe(0o640);
    expect(readFileSync(session, "utf8")).toBe("session");
    expect(readFileSync(named, "utf8")).toBe("named account");
    const rendered = readFileSync(f.css, "utf8");
    expect(rendered).not.toContain("{{");
    expect(rendered).not.toContain("old stylesheet");
    const nativeValues = f.inspect();
    expect(nativeValues).toMatchObject({
      useragent,
      useragentType: "QString",
      webFontFamily: f.theme.fonts.ui,
      windowTheme: "dark",
      customCssEnabled: true,
      incoming: "rgb(36, 40, 59)",
      outgoing: "rgb(41, 46, 66)",
      fade: "rgb(41, 46, 66)",
      bubbleRadius: "0px",
      buttonRadius: "0px",
      avatarRadius: "50%",
    });
    expect(nativeValues.codeFont).toContain(f.theme.fonts.mono);
    expect(f.run().exitCode).toBe(0);
    expect(readFileSync(f.native, "utf8")).toBe(native);
    expect(readFileSync(f.css, "utf8")).toBe(rendered);
    expect(readFileSync(f.env.TEST_COMMANDS, "utf8").trim().split("\n")).toEqual([
      '["theme","get","--json"]',
      '["theme","get","--json"]',
    ]);
  } finally {
    f.cleanup();
  }
}, 30_000);

test("Whatly creates missing default paths and refreshes light themes without forcing square corners", () => {
  const f = fixture(false);
  try {
    expect(f.run().exitCode).toBe(0);
    Object.assign(f.theme.colors, lightColors, { mode: "light" });
    f.theme.appearance.rounding = 8;
    f.theme.fonts.ui = '@A "quoted", \\ {{colors.accent}} family';
    f.saveTheme();
    const result = f.run();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(f.inspect()).toMatchObject({
      webFontFamily: f.theme.fonts.ui,
      windowTheme: "light",
      useragent,
      outgoing: "rgb(183, 193, 223)",
      fade: "rgb(183, 193, 223)",
      bubbleRadius: "18px",
      buttonRadius: "8px",
    });
    expect(readFileSync(f.css, "utf8")).not.toContain("border-radius: 0");
    expect(readdirSync(dirname(f.native))).toEqual(["whatly.conf"]);
    expect(readdirSync(dirname(f.css))).toEqual(["custom.css"]);
  } finally {
    f.cleanup();
  }
}, 30_000);

test("Whatly rejects linked or invalid destinations before publishing either file", () => {
  for (const linked of ["settings", "css"]) {
    const f = fixture();
    try {
      const outside = join(f.root, "outside");
      mkdirSync(outside);
      const destination = linked === "settings" ? f.configHome : f.dataHome;
      mkdirSync(destination);
      symlinkSync(outside, join(destination, "shakaran"));
      const result = f.run();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("ordinary files or directories");
      expect(readdirSync(outside)).toEqual([]);
      expect(existsSync(linked === "settings" ? f.css : f.native)).toBe(false);
      expect(f.run({ XDG_CONFIG_HOME: "relative/path" }).exitCode).toBe(1);
    } finally {
      f.cleanup();
    }
  }
});

test("Whatly leaves originals intact on theme failures and refuses external edits", () => {
  const f = fixture();
  try {
    f.write(f.native, "[General]\ntrayIcon=true\n");
    f.write(f.css, "old stylesheet");
    expect(f.run({ TEST_FAIL: "1" }).exitCode).toBe(1);
    expect(readFileSync(f.native, "utf8")).toBe("[General]\ntrayIcon=true\n");
    expect(readFileSync(f.css, "utf8")).toBe("old stylesheet");
    f.write(f.env.TEST_THEME, JSON.stringify({ succes: false, errMessage: "invalid theme" }));
    expect(f.run().exitCode).toBe(1);
    f.saveTheme();
    for (const target of [f.native, f.css]) {
      const result = f.run({ TEST_EDIT: target });
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("changed during setup");
      expect(readFileSync(target, "utf8")).toBe("external edit\n");
    }
    expect(readdirSync(dirname(f.native))).toEqual(["whatly.conf"]);
    expect(readdirSync(dirname(f.css))).toEqual(["custom.css"]);
  } finally {
    f.cleanup();
  }
});

test("Whatly replaces entire continued values only in the native General section", () => {
  const source =
    '[General]\nuseragent="old\\\n continued"\ntrayIcon=true\n\n[%General]\nuseragent=unrelated\n';
  const defaults = '[General]\nuseragent="new"\nwindowTheme=dark\n';
  const result = settings({ source, defaults });
  expect(result).toBe(
    '[General]\nuseragent="new"\nwindowTheme=dark\ntrayIcon=true\n\n[%General]\nuseragent=unrelated\n',
  );
  expect(settings({ source: "[shortcuts]\nfindChat=Alt+F\n", defaults })).toBe(
    defaults + "[shortcuts]\nfindChat=Alt+F\n",
  );
});
