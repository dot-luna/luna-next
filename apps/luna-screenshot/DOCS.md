# Screenshots and text extraction

`luna install luna-screenshot` installs the capture tools, Tesseract, and its
English model, and exports `config/screenshot.jsonc` to Luna's configuration home.
Reconfiguring the app replaces that settings file.

- **Win+X**: select a region and copy English text.
- **Print**: select a region and save/copy its image.
- **Shift+Print**, **Alt+Print**, **Ctrl+Print**: capture the current screen,
  active window, or all screens.

After updating the CLI, apply shortcuts with `luna configure hypr` and
`hyprctl reload`. `luna screenshot text` also works without a shortcut.
Escape cancels. Text extraction runs locally and keeps no screenshot; an empty
result leaves the clipboard unchanged. Small or low-contrast text may be misread.

## Settings

Edit `~/.config/luna/screenshot.jsonc` (or
`$LUNA_CONFIG_HOME_DIR/screenshot.jsonc`; `$XDG_CONFIG_HOME/luna` is also respected).
Settings are read on each text capture, without a restart.

| Key                    | Default   | Values                                                                                   |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `text.layout`          | `"block"` | `"block"` for website paragraphs, `"line"` for one line, `"sparse"` for scattered labels |
| `text.preserve_spaces` | `false`   | Preserve larger spaces between words when `true`                                         |

English and the neural recognition engine are fixed. Sparse mode does not promise
reading order. Missing settings use defaults in memory; a missing file is created
as `{}`. Invalid settings stop extraction before selection.

Use `luna screenshot text --config PATH` for a different JSONC file.
See [CLI usage](../../src/luna-cli/DOCS.md#screenshots) for image capture options.

## Checks

From the repository root:

```sh
bun test packages/luna-api/tests/screenshot.test.ts src/luna-cli/tests/screenshot.test.ts __tests__/apps/luna-screenshot __tests__/apps/hypr-screenshot-bindings.test.ts
bun run --cwd packages/luna-api check
bun run --cwd src/luna-cli check
```
