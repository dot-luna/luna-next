const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  defaults,
  settings,
  fonts,
  style,
  boxy,
  fixture,
  assertRestored,
} = require("./fixtures.cjs");

test("builds with JSON defaults, font fallbacks and square controls without changing saved preferences", (t) => {
  const f = fixture(t);
  assert.equal(
    f.prepare(() => {
      const patched = f.read("packages/contracts/src/settings.ts");
      assert.deepEqual(JSON.parse(f.read("packages/contracts/src/luna-defaults.json")), defaults);
      for (const key of Object.keys(defaults)) {
        assert.ok(patched.includes(`Effect.succeed(lunaDefaults.${key})`), key);
      }
      assert.ok(
        patched.includes(
          "confirmThreadDelete: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true)))",
        ),
      );
      const fontSource = f
        .read("apps/web/src/appearanceFonts.ts")
        .replace(/^import .*\n/, "")
        .replaceAll("export const", "const");
      const stacks = Function(
        "lunaDefaults",
        `${fontSource}; return [DEFAULT_SANS_FONT_STACK, DEFAULT_CODE_FONT_STACK];`,
      )(defaults);
      assert.equal(
        stacks[0],
        '"Outfit", -apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif',
      );
      assert.equal(
        stacks[1],
        '"Iosevka Nerd Font", "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
      );
      const css = f.read("apps/web/src/index.css");
      assert.ok(css.includes('--font-sans:\n    "Outfit", -apple-system'));
      assert.ok(css.includes('--font-mono:\n    "Iosevka Nerd Font", ui-monospace'));
      assert.ok(css.endsWith(boxy));
      assert.ok(css.includes(".unrelated { color: red; }"));
      const handler = f.read("apps/desktop/src/app/DesktopLinuxUrlHandler.ts");
      const entry = Function(
        handler.replace("export function", "function") + "\nreturn renderUrlHandlerDesktopEntry();",
      )();
      assert.ok(entry.includes("NoDisplay=false\n"));
      assert.ok(entry.includes("StartupWMClass=t3code\n"));
      assert.ok(entry.includes("MimeType=x-scheme-handler/t3code;\n"));
      assert.equal(
        f.read("userdata/client-settings.json"),
        f.files["userdata/client-settings.json"],
      );
      assert.equal(fs.statSync(f.settingsPath).mode & 0o777, 0o640);
      return "built";
    }),
    "built",
  );
  assertRestored(f);
});

test("rejects an upstream desktop entry contract change before modifying sources", (t) => {
  const f = fixture(t);
  const file = "apps/desktop/src/app/DesktopLinuxUrlHandler.ts";
  const changed = f.read(file).replace('"NoDisplay=true"', '"Hidden=true"');
  fs.writeFileSync(path.join(f.root, file), changed);
  assert.throws(() => f.prepare(() => assert.fail("must not build")), /T3 source changed.*NoDisplay/);
  assert.equal(f.read(file), changed);
  assert.equal(f.read("packages/contracts/src/settings.ts"), settings);
  assert.equal(f.read("apps/web/src/index.css"), style);
  assert.equal(fs.existsSync(path.join(f.root, "packages/contracts/src/luna-defaults.json")), false);
});

test("restores original bytes and modes after a failed build and can run again", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      f.prepare(() => {
        fs.chmodSync(f.settingsPath, 0o600);
        throw new Error("build failed");
      }),
    /build failed/,
  );
  assertRestored(f);
  f.prepare(() => assert.equal(f.read("apps/web/src/index.css").split(boxy.trim()).length, 2));
  assertRestored(f);
});

test("checks every upstream contract before changing source files", (t) => {
  const f = fixture(t);
  const changed = style.replace("--font-mono:", "--font-code:");
  fs.writeFileSync(path.join(f.root, "apps/web/src/index.css"), changed);
  let ran = false;
  assert.throws(
    () =>
      f.prepare(() => {
        ran = true;
      }),
    /T3 source changed.*--font-mono/,
  );
  assert.equal(ran, false);
  assert.equal(f.read("packages/contracts/src/settings.ts"), settings);
  assert.equal(f.read("apps/web/src/appearanceFonts.ts"), fonts);
  assert.equal(f.read("apps/web/src/index.css"), changed);
  assert.equal(
    fs.existsSync(path.join(f.root, "packages/contracts/src/luna-defaults.json")),
    false,
  );
});

test("rejects duplicate upstream targets and preexisting generated defaults", (t) => {
  const f = fixture(t);
  const duplicate = `${fonts}\n${fonts}`;
  fs.writeFileSync(path.join(f.root, "apps/web/src/appearanceFonts.ts"), duplicate);
  assert.throws(() => f.prepare(() => {}), /expected one DEFAULT_SANS_FONT_STACK/);
  assert.equal(f.read("packages/contracts/src/settings.ts"), settings);
  fs.writeFileSync(path.join(f.root, "apps/web/src/appearanceFonts.ts"), fonts);
  fs.writeFileSync(path.join(f.root, "packages/contracts/src/luna-defaults.json"), "keep");
  assert.throws(() => f.prepare(() => {}), /build defaults already exist/);
  assert.equal(f.read("packages/contracts/src/luna-defaults.json"), "keep");
  assert.equal(f.read("packages/contracts/src/settings.ts"), settings);
});

test("rejects malformed, incomplete or unsupported defaults before preparing", (t) => {
  const f = fixture(t);
  for (const invalid of [
    "{",
    "[]",
    "null",
    JSON.stringify({ ...defaults, fontFamilySans: undefined }),
    JSON.stringify({ ...defaults, fontFamilySans: "" }),
    JSON.stringify({ ...defaults, fontFamilyCode: "bad\nfont" }),
    JSON.stringify({ ...defaults, fontFamilyTerminal: "x".repeat(201) }),
    JSON.stringify({ ...defaults, mathRenderingEnabled: "true" }),
    JSON.stringify({ ...defaults, extraSetting: true }),
  ]) {
    fs.writeFileSync(path.join(f.root, "defaults.json"), invalid);
    assert.throws(() => f.prepare(() => assert.fail("must not build")));
    assert.equal(f.read("packages/contracts/src/settings.ts"), settings);
    assert.equal(f.read("apps/web/src/appearanceFonts.ts"), fonts);
    assert.equal(f.read("apps/web/src/index.css"), style);
  }
});

test("rejects missing inputs and source symlinks without writing through them", (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, "boxy.css"));
  assert.throws(() => f.prepare(() => {}), /ENOENT/);
  fs.writeFileSync(path.join(f.root, "boxy.css"), boxy);
  fs.renameSync(f.settingsPath, `${f.settingsPath}.original`);
  fs.symlinkSync(`${f.settingsPath}.original`, f.settingsPath);
  assert.throws(() => f.prepare(() => {}), /source must be a regular file/);
  assert.equal(fs.readFileSync(`${f.settingsPath}.original`, "utf8"), settings);
});
