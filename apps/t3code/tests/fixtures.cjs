const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { withPreparedSources } = require("../src/prepare.cjs");

const defaults = {
  fontFamilySans: "Outfit",
  fontFamilyCode: "Iosevka Nerd Font",
  fontFamilyComposer: "Outfit",
  fontFamilyTerminal: "Iosevka Nerd Font",
  mathRenderingEnabled: true,
};
// These excerpts retain upstream's decoding and font fallback contracts.
const settings = `export const ClientSettingsSchema = Schema.Struct({
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  fontFamilyCode: FontFamilyPreference.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  fontFamilyComposer: FontFamilyPreference.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  fontFamilySans: FontFamilyPreference.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  fontFamilyTerminal: FontFamilyPreference.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  // Opt-in TeX typesetting in rendered Markdown. Off keeps math parsing and
  // KaTeX out of the render path entirely.
  mathRenderingEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export const DEFAULT_CLIENT_SETTINGS = Schema.decodeSync(ClientSettingsSchema)({});
`;
const fonts = `export const DEFAULT_SANS_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif';

// Some engines map \`ui-monospace\` to a proportional font, so prefer concrete names.
export const DEFAULT_CODE_FONT_STACK =
  '"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';
`;
const style = `@theme {
  --font-sans:
    -apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif;
  --font-mono:
    ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
}
.unrelated { color: red; }
`;
const boxy = "*, *::before, *::after { border-radius: 0 !important; }\n";
const desktopHandler = `// The AppImage integration entry owns the window identity. This
// hidden URL-only entry must not compete with it for StartupWMClass matching.
export function renderUrlHandlerDesktopEntry() {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=T3 Code",
    "NoDisplay=true",
    "MimeType=x-scheme-handler/t3code;",
    "",
  ].join("\\n");
}
`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luna-t3-prepare-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    "packages/contracts/src/settings.ts": settings,
    "apps/web/src/appearanceFonts.ts": fonts,
    "apps/web/src/index.css": style,
    "apps/desktop/src/app/DesktopLinuxUrlHandler.ts": desktopHandler,
    "defaults.json": JSON.stringify(defaults),
    "boxy.css": boxy,
    "userdata/client-settings.json":
      '{"onboardingCompletedAt":"already-complete","mathRenderingEnabled":false}',
  };
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const settingsPath = path.join(root, "packages/contracts/src/settings.ts");
  fs.chmodSync(settingsPath, 0o640);
  return {
    root,
    files,
    settingsPath,
    prepare: (build) =>
      withPreparedSources(
        root,
        path.join(root, "defaults.json"),
        path.join(root, "boxy.css"),
        build,
      ),
    read: (file) => fs.readFileSync(path.join(root, file), "utf8"),
  };
}

function assertRestored(fixture) {
  for (const [file, content] of Object.entries(fixture.files)) {
    assert.equal(fixture.read(file), content, file);
  }
  assert.equal(fs.statSync(fixture.settingsPath).mode & 0o777, 0o640);
  assert.equal(
    fs.existsSync(path.join(fixture.root, "packages/contracts/src/luna-defaults.json")),
    false,
  );
}

module.exports = { defaults, settings, fonts, style, boxy, fixture, assertRestored };
