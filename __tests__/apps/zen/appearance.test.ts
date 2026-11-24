import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAppearance } from "../../../apps/zen/src/appearance.ts";
import { themeValues } from "../../../packages/luna-api/src/modules/theme/values.ts";

const zen = Bun.which("zen-browser");
const python = Bun.which("python3");

test("browser rounding never changes website styles", async () => {
  const theme = themeValues.resolve({ source: {}, name: "test" });
  const square = await renderAppearance(theme, {});
  const rounded = await renderAppearance(
    { ...theme, appearance: { ...theme.appearance, rounding: 12 } },
    {},
  );
  expect(square[1]).toContain("border-radius: 0 !important");
  expect(rounded[1]).not.toContain("border-radius: 0 !important");
  expect(square[2]).toBe(rounded[2]);
  expect(square[2]).not.toMatch(/url-prefix\("https?:/u);
  const font = 'Font "{{colors.accent}}"';
  const rendered = await renderAppearance({ ...theme, fonts: { ...theme.fonts, ui: font } }, {});
  expect(rendered[1]).toContain(JSON.stringify(font));
});

test.skipIf(!zen || !python).each(["dark", "light"] as const)(
  "native Zen %s controls and internal pages use paired theme colors",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "luna-zen-style-"));
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          '<!doctype html><style>#luna-fixture{border-radius:19px;background:#123456;color:#fedcba}</style><button id="luna-fixture">Website</button>',
          { headers: { "content-type": "text/html" } },
        ),
    });
    const url = `http://127.0.0.1:${server.port}/`;
    try {
      const theme = themeValues.resolve({
        source:
          mode === "dark"
            ? {}
            : {
                colors: {
                  mode,
                  background: "#fafafa",
                  dark_background: "#ffffff",
                  lighter_background: "#eeeeee",
                  foreground: "#222222",
                  light_foreground: "#444444",
                  selection: "#ccddee",
                  selection_foreground: "#112233",
                },
              },
        name: "test",
      });
      const rendered = await renderAppearance(theme, {
        "toolkit.legacyUserProfileCustomizations.stylesheets": true,
        "zen.welcome-screen.seen": true,
        "browser.shell.checkDefaultBrowser": false,
        "browser.startup.homepage_override.mstone": "ignore",
        "datareporting.policy.dataSubmissionEnabled": false,
      });
      for (const [index, name] of [
        "user.js",
        "chrome/userChrome.css",
        "chrome/userContent.css",
      ].entries())
        await Bun.write(join(root, name), rendered[index]!);
      const child = Bun.spawn([python!, join(import.meta.dir, "style-probe.py"), root, zen!, url], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, output, error] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code, error).toBe(0);
      const result = JSON.parse(output);
      const rgb = (hex: string) =>
        `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
      expect(result.find.bar).toMatchObject({
        bg: rgb(theme.colors.lighter_background),
        fg: rgb(theme.colors.foreground),
        radius: "0px",
      });
      expect(result.find.field).toMatchObject({
        bg: rgb(theme.colors.dark_background),
        fg: rgb(theme.colors.foreground),
      });
      expect(result.find.error).toMatchObject({
        bg: rgb(theme.colors.error),
        fg: rgb(theme.colors.error_foreground),
      });
      expect(result.find.warning).toMatchObject({
        bg: rgb(theme.colors.warning),
        fg: rgb(theme.colors.warning_foreground),
      });
      for (const [id, styles] of Object.entries(result.surfaces))
        expect(styles, id).toMatchObject({
          panel: theme.colors.lighter_background,
          text: theme.colors.foreground,
        });
      for (const [page, styles] of Object.entries(result.pages)) {
        if (page !== url)
          expect(styles, page).toMatchObject({
            bg: rgb(theme.colors.background),
            fg: rgb(theme.colors.foreground),
          });
      }
      expect(result.pages[url].fixture).toEqual({
        radius: "19px",
        bg: "rgb(18, 52, 86)",
        fg: "rgb(254, 220, 186)",
      });
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
