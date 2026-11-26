import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ThemeFixture } from "../../../packages/luna-api/tests/fixtures/theme-fixture.ts";
import { themeRequest } from "../src/themes.ts";

let f: ThemeFixture;
beforeEach(() => {
  f = new ThemeFixture();
});
afterEach(() => f.dispose());

test("Settings uses API info before installation, then publishes real palettes and selections", async () => {
  const file = join(f.root, "theme.jsonc");
  f.write(file, '{"colors":{"mode":"light","accent":"#123456"}}');
  const info = await themeRequest(
    { operation: "preview", value: new URL(`file://${file}`).href },
    f.options,
  );
  expect(info).toMatchObject({ succes: true, data: { needsName: true, suggestedName: "theme" } });
  expect(existsSync(f.libraryDir)).toBe(false);
  const installed = await themeRequest(
    { operation: "install", value: file, name: "custom" },
    f.options,
  );
  expect(installed).toMatchObject({
    succes: true,
    data: [{ name: "custom", current: false, mode: "light", accent: "#123456" }],
  });
  const selected = await themeRequest({ operation: "select", value: "custom" }, f.options);
  expect(selected).toMatchObject({ succes: true, data: [{ name: "custom", current: true }] });
  expect(await themeRequest({ operation: "remove", value: "custom" }, f.options)).toMatchObject({
    succes: false,
  });
  expect(await themeRequest({ operation: "random" }, f.options)).toMatchObject({ succes: true });
  f.write(f.configFile, "{}");
  expect(await themeRequest({ operation: "remove", value: "custom" }, f.options)).toMatchObject({
    succes: true,
    data: [],
  });
});
