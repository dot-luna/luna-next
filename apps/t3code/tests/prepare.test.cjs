const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { settings, fonts, style, boxy, fixture, assertRestored } = require("./fixtures.cjs");

test("patches square controls and menu integration while leaving native fonts and settings untouched", (t) => {
  const f = fixture(t);
  assert.equal(f.prepare(() => {
    assert.equal(f.read("packages/contracts/src/settings.ts"), settings);
    assert.equal(f.read("apps/web/src/appearanceFonts.ts"), fonts);
    assert.equal(fs.existsSync(path.join(f.root, "packages/contracts/src/luna-defaults.json")), false);
    const css = f.read("apps/web/src/index.css");
    assert.ok(css.startsWith(style.trimEnd()));
    assert.ok(css.endsWith(boxy));
    const handler = f.read("apps/desktop/src/app/DesktopLinuxUrlHandler.ts");
    const entry = Function(handler.replace("export function", "function") + "\nreturn renderUrlHandlerDesktopEntry();")();
    assert.ok(entry.includes("NoDisplay=false\n"));
    assert.ok(entry.includes("StartupWMClass=t3code\n"));
    assert.ok(entry.includes("MimeType=x-scheme-handler/t3code;\n"));
    assert.equal(f.read("userdata/client-settings.json"), f.files["userdata/client-settings.json"]);
    return "built";
  }), "built");
  assertRestored(f);
});

test("rejects changed and duplicate desktop entry contracts before writing any source", (t) => {
  const f = fixture(t);
  const file = "apps/desktop/src/app/DesktopLinuxUrlHandler.ts";
  const original = f.read(file);
  for (const changed of [original.replace('"NoDisplay=true"', '"Hidden=true"'), original + original]) {
    fs.writeFileSync(path.join(f.root, file), changed);
    assert.throws(() => f.prepare(() => assert.fail("must not build")), /T3 source changed/);
    assert.equal(f.read(file), changed);
    assert.equal(f.read("apps/web/src/index.css"), style);
  }
});

test("restores original bytes and modes after a failed build and can run again", (t) => {
  const f = fixture(t);
  const css = path.join(f.root, "apps/web/src/index.css");
  fs.chmodSync(css, 0o640);
  assert.throws(() => f.prepare(() => { fs.chmodSync(css, 0o600); throw new Error("build failed"); }), /build failed/);
  assertRestored(f);
  assert.equal(fs.statSync(css).mode & 0o777, 0o640);
  f.prepare(() => assert.equal(f.read("apps/web/src/index.css").split(boxy.trim()).length, 2));
  assertRestored(f);
});

test("rejects empty CSS, asynchronous callbacks and linked source targets without writing through them", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "boxy.css"), " ");
  assert.throws(() => f.prepare(() => {}), /must not be empty/);
  fs.writeFileSync(path.join(f.root, "boxy.css"), boxy);
  assert.throws(() => f.prepare(() => Promise.resolve()), /synchronous/);
  assertRestored(f);
  const css = path.join(f.root, "apps/web/src/index.css");
  fs.renameSync(css, css + ".original");
  fs.symlinkSync(css + ".original", css);
  assert.throws(() => f.prepare(() => {}), /source must be a regular file/);
  assert.equal(fs.readFileSync(css + ".original", "utf8"), style);
});
