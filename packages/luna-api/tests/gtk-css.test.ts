import { expect, test } from "bun:test";
import { gtkCss } from "../src/theme/gtk-css.ts";
import { resolveTheme } from "../src/theme/values.ts";

test.each(["dark", "light"] as const)("GTK3 uses its bundled %s widget structure", (mode) => {
  const css = gtkCss(resolveTheme({}, "test"), mode);
  const suffix = mode === "dark" ? "-dark" : "";
  expect(css).toContain(
    `@import url("resource:///org/gtk/libgtk/theme/Adwaita/gtk-contained${suffix}.css");`,
  );
  expect(css).not.toContain("/usr/share/themes");
});

test("native GTK roles and explicit widget overrides use the resolved Luna palette", () => {
  const theme = resolveTheme(
    {
      colors: {
        background: "#101112",
        foreground: "#eeeeee",
        dark_background: "#070809",
        lighter_background: "#202122",
        muted: "#404142",
        accent: "#dd8800",
        accent_foreground: "#010203",
        selection: "#225588",
        selection_foreground: "#fffefe",
      },
    },
    "custom",
  );
  const css = gtkCss(theme, "dark");
  expect(css).toContain("@define-color theme_bg_color #101112;");
  expect(css).toContain("@define-color theme_fg_color #eeeeee;");
  expect(css).toContain("@define-color theme_base_color #070809;");
  expect(css).toContain("@define-color borders #404142;");
  expect(css).toContain("@define-color theme_selected_bg_color #225588;");
  expect(css).toContain("@define-color theme_selected_fg_color #fffefe;");
  expect(css).toMatch(/window[^{}]*\{[^{}]*background-color: @theme_bg_color;/u);
  expect(css).toMatch(/menu[^{}]*\{[^{}]*background-color: @theme_base_color;/u);
  expect(css).toMatch(/menuitem:hover[^{}]*\{[^{}]*background-color: @theme_selected_bg_color;/u);
  expect(css).toMatch(/button:backdrop[^{}]*\{[^{}]*background-color: #202122;/u);
  expect(css).toMatch(
    /button:hover[^{}]*\{[^{}]*color: @theme_selected_fg_color;[^{}]*background-color: #225588;/u,
  );
  expect(css).toMatch(/entry:backdrop[^{}]*\{[^{}]*background-color: @theme_base_color;/u);
  expect(css).toMatch(/entry:focus[^{}]*\{[^{}]*border-color: #dd8800;/u);
  expect(css).toMatch(
    /switch:checked[^{}]*\{[^{}]*color: #010203;[^{}]*background-color: #dd8800;/u,
  );
  expect(css).toMatch(/menuitem:disabled:backdrop[^{}]*\{[^{}]*color: @insensitive_fg_color;/u);
});

test("explicit system mode changes structure without replacing authored palette colors", () => {
  const theme = resolveTheme({ colors: { mode: "light", accent: "#123456" } }, "light");
  const dark = gtkCss(theme, "dark");
  const light = gtkCss(theme, "light");
  expect(dark.replace("gtk-contained-dark.css", "gtk-contained.css")).toBe(light);
  expect(dark).toContain(`@define-color theme_bg_color ${theme.colors.background};`);
  expect(dark).toContain("background-color: #123456;");
  expect(theme.colors.mode).toBe("light");
});

test.each(["ui", "mono"] as const)(
  "%s font punctuation stays inside one escaped CSS string",
  (font) => {
    const theme = resolveTheme(
      { fonts: { [font]: 'Odd \\"; } button { color: red; } /*' } },
      "font",
    );
    const css = gtkCss(theme, "dark");
    expect(css).toContain('font-family: "Odd \\\\\\"; } button { color: red; } /*";');
    expect(css).not.toContain('font-family: "Odd \\";');
  },
);

test("explicitly monospace widgets and their text nodes use the mono font", () => {
  const theme = resolveTheme({ fonts: { ui: "Luna UI", mono: "Luna Code" } }, "fonts");
  const css = gtkCss(theme, "dark");
  expect(css).toMatch(/\* \{\s*font-family: "Luna UI";/u);
  expect(css).toContain('.monospace, .monospace * { font-family: "Luna Code"; }');
});

test.each([0, 17])("GTK3 surfaces and ordinary controls accept %ipx rounding", (rounding) => {
  const theme = resolveTheme({ appearance: { rounding } }, "rounding");
  const css = gtkCss(theme, "dark");
  const rule = css.match(/([^{}]+)\{\s*border-radius: (\d+)px;\s*\}/u);
  expect(rule?.[2]).toBe(String(rounding));
  const selectors = rule?.[1]
    ?.replace(/\/\*.*?\*\//gsu, "")
    .trim()
    .split(/,\s*/u);
  expect(selectors).toContain("button");
  expect(selectors).toContain("entry");
  expect(selectors).toContain("menuitem");
  expect(selectors).toContain(".csd menu");
  expect(selectors).toContain(".csd popover.background");
  expect(selectors).not.toContain("*");
  expect(selectors).not.toContain("window");
  expect(selectors).not.toContain("radio");
  expect(selectors).not.toContain("button.circular");
});
