# Components

`Theme.snapshot` takes a resolved Luna theme. Pass that `Theme` to each component's
required `theme` property. Replacing the snapshot updates existing components.
The library does not load configuration or call the API.

| Component     | Defaults                                                  |
| ------------- | --------------------------------------------------------- |
| `Title`       | 24 px, semibold, foreground color                         |
| `Subtitle`    | 18 px, medium, subdued foreground                         |
| `Text`        | 13 px, normal, foreground color                           |
| `Button`      | Primary variant, at least 80 × 36 px                      |
| `Badge`       | Primary variant, 11 px text                               |
| `Dialog`      | Modal surface with Luna styling and open/close animations |
| `InputDialog` | Modal dialog with one input and Cancel/Add actions        |

Typography renders plain text and wraps. Standard QML properties such as `text`,
`font`, `color`, and `width` remain customizable.

`Button.variant` accepts `UI.Button.Primary`, `Secondary`, `Outline`, or `Ghost`.
Buttons use Luna's colors, font, rounding, and border width. Outline keeps a minimum
1 px border. Keyboard focus has a separate visible ring.

Buttons support Tab navigation, Space, Return, Enter, mouse clicks, disabled states,
and native Qt actions. Hover and press color animations do not delay activation.

`Badge.variant` accepts `UI.Badge.Primary`, `Secondary`, `Outline`, or `Destructive`.
Set its `text` and `theme`; it sizes to its label.

`Dialog` supplies the shared themed modal surface. Put custom content in its
`contentItem`; the caller owns focus and actions.

`InputDialog` takes `theme`, `title`, `fieldLabel`, `placeholderText`, and `actionText`.
Call `open()` to clear and immediately focus its input. Dialogs fade and scale when
opening and closing. `submitted(value)` supplies trimmed input;
the caller validates it and calls `close()` after success. Set `errorMessage` to keep
an error visible, or `busy` to prevent duplicate submissions. Cancel and Escape dismiss
it without cancelling the caller's operation.

## Importing

Import `Luna.UI 1.0 as UI` with this package's `src/` on `QML_IMPORT_PATH`.
For installed apps, copy `src/Luna/` with the app and add its parent to the import path.
No compilation is needed.

## Checks

From the repository root:

```sh
bun run --cwd packages/luna-ui check
bun run --cwd packages/luna-ui test
```

Tests use Qt 6 Declarative's `qmltestrunner` offscreen. No desktop session is changed.
