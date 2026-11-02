import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "pathe";
import { Luna } from "../src/index.ts";
import { defaultsSchema } from "../src/defaults/schema.ts";
import { DefaultsNativeFixture } from "./fixtures/defaults-native-fixture.ts";

let f: DefaultsNativeFixture;
beforeEach(() => {
  f = new DefaultsNativeFixture();
  for (const name of ["flock", "bash"]) symlinkSync(Bun.which(name)!, join(f.bin, name));
  f.command("viewer", "exit 99");
  f.entry("images.desktop", "MimeType=image/png;image/jpeg;\n");
  f.entry("other.desktop", "MimeType=image/png;application/pdf;\n");
});
afterEach(() => f.dispose());
const options = () => ({ repository: f.repository, env: f.env });
function manifest(value: Record<string, string>) {
  const source = `// Authored choices stay intact.\n${JSON.stringify(value, null, 2)}\n`;
  f.write(join(f.repository, "installs/defaults.jsonc"), source);
  return source;
}

test.each([
  { browser: "viewer.desktop" },
  { "image/*": "viewer" },
  { "text/*": "viewer.desktop" },
  { "application/pdf": "../viewer.desktop" },
  { shell: "zsh --unsafe" },
  { shell: "-zsh" },
  { shell: "/bin/zsh\u0000" },
])("defaults reject invalid keys or application identifiers: %j", (value) => {
  expect(defaultsSchema.safeParse(value).success).toBe(false);
});

test("reset expands supported media types, keeps exact overrides and preserves authored defaults", async () => {
  const source = manifest({ "image/*": "images.desktop", "image/png": "other.desktop" });
  const response = await Luna.defaults.reset([], options());
  expect(response).toEqual({
    succes: true,
    data: {
      applied: {
        "image/jpeg": "images.desktop",
        "image/png": "other.desktop",
      },
    },
  });
  const preferences = f.read(join(f.config, "mimeapps.list"));
  expect(preferences).toContain("image/png=other.desktop;");
  expect(preferences).toContain("image/jpeg=images.desktop;");
  expect(preferences).not.toContain("image/*");
  expect(preferences).not.toContain("video/");
  expect(f.read(join(f.repository, "installs/defaults.jsonc"))).toBe(source);
});

test("scoped wildcard reset preserves an explicit format until its own reset", async () => {
  manifest({ "image/png": "other.desktop", "image/*": "images.desktop" });
  f.write(join(f.config, "mimeapps.list"), "[Default Applications]\nimage/png=personal.desktop;\n");
  expect(await Luna.defaults.reset(["image/*"], options())).toEqual({
    succes: true,
    data: { applied: { "image/jpeg": "images.desktop" } },
  });
  expect(f.read(join(f.config, "mimeapps.list"))).toContain("image/png=personal.desktop;");
  expect(await Luna.defaults.reset(["image/png"], options())).toEqual({
    succes: true,
    data: { applied: { "image/png": "other.desktop" } },
  });
});

test("set supports an explicit MIME association without a manifest or advertised type", async () => {
  expect(await Luna.defaults.set("text/plain", "other.desktop", options())).toEqual({
    succes: true,
    data: { applied: { "text/plain": "other.desktop" } },
  });
  expect(f.read(join(f.config, "mimeapps.list"))).toContain("text/plain=other.desktop;");
  expect(existsSync(join(f.repository, "installs/defaults.jsonc"))).toBe(false);
});

test("unavailable applications and unsupported media groups fail before preference changes", async () => {
  manifest({ "application/pdf": "other.desktop", "video/*": "images.desktop" });
  const path = join(f.config, "mimeapps.list");
  const previous = "# personal\n[Default Applications]\napplication/pdf=personal.desktop;\n";
  f.write(path, previous);
  expect(await Luna.defaults.reset([], options())).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(f.read(path)).toBe(previous);
  expect(await Luna.defaults.set("application/pdf", "missing.desktop", options())).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(f.read(path)).toBe(previous);
});

test("reset rejects unknown selections without changing other configured entries", async () => {
  manifest({ "application/pdf": "other.desktop" });
  expect(await Luna.defaults.reset(["image/*"], options())).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(existsSync(join(f.config, "mimeapps.list"))).toBe(false);
});

test("terminal defaults require a terminal emulator, not a terminal application", async () => {
  f.command("xdg-terminal-exec");
  expect(await Luna.defaults.set("terminal", "other.desktop", options())).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(existsSync(join(f.config, "xdg-terminals.list"))).toBe(false);
});

test("terminal selection rejects entries without an execution argument before changing preferences", async () => {
  f.command("xdg-terminal-exec");
  f.entry("compat-only.desktop", "Categories=TerminalEmulator;\n");
  const path = join(f.config, "xdg-terminals.list");
  const previous = "/execarg_strict\nexisting.desktop\n";
  f.write(path, previous);
  expect(await Luna.defaults.set("terminal", "compat-only.desktop", options())).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(f.read(path)).toBe(previous);
});

const nativeTerminal = Bun.which("xdg-terminal-exec");
for (const mode of ["directive", "environment"]) {
  test.skipIf(!nativeTerminal)(
    `native terminal selection stays effective in strict ${mode} mode`,
    async () => {
      f.env.PATH = `${f.bin}:/usr/bin:/bin`;
      if (mode === "environment") f.env.XTE_EXECARG_COMPAT = "false";
      else f.write(join(f.config, "xdg-terminals.list"), "/execarg_strict\n");
      f.entry("valid-terminal.desktop", "Categories=TerminalEmulator;\nX-TerminalArgExec=--\n");
      f.entry("compat-only.desktop", "Categories=TerminalEmulator;\n");
      expect(
        await Luna.defaults.set("terminal", "valid-terminal.desktop", options()),
      ).toMatchObject({ succes: true });
      expect(await Luna.defaults.set("terminal", "compat-only.desktop", options())).toMatchObject({
        succes: false,
        err: "INVALID_ARGUMENT",
      });
      const result = Bun.spawnSync([nativeTerminal!, "--print-id"], {
        env: { ...f.env, XTE_CACHE_ENABLED: "0" },
      });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(result.stdout.toString().trim()).toBe("valid-terminal.desktop");
    },
  );
}

test("media defaults ignore invalid advertised types and support fully overridden groups", async () => {
  f.entry(
    "images.desktop",
    "MimeType=image/png;image/jpeg;image/*;image/png=unsafe;image/\\ninvalid;\n",
  );
  manifest({
    "image/*": "images.desktop",
    "image/png": "other.desktop",
    "image/jpeg": "other.desktop",
  });
  expect(await Luna.defaults.reset(["image/*"], options())).toEqual({
    succes: true,
    data: { applied: {} },
  });
  expect(existsSync(join(f.config, "mimeapps.list"))).toBe(false);
  const response = await Luna.defaults.set("image/*", "images.desktop", options());
  expect(response).toEqual({
    succes: true,
    data: { applied: { "image/jpeg": "images.desktop", "image/png": "images.desktop" } },
  });
});
