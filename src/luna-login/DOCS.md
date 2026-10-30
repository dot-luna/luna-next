# Luna Login

## Setup and commands

Requires SDDM with the Qt 6 greeter, Qt Quick, and Qt Quick Controls. Video needs
Qt 6 Multimedia and a working codec backend (`qt6-multimedia` and
`qt6-multimedia-ffmpeg` on Arch). Automatic media detection needs `file`.
Font families must be installed system-wide so
the SDDM account can use them. No Quickshell or Luna process runs in the greeter.

Install with `luna install --local login`. App setup exports
`~/.config/luna-next/login.conf`; it does not enable a theme. `$XDG_CONFIG_HOME`
and `$XDG_DATA_HOME` apply; `LUNA_LOGIN_CONFIG` overrides the config file.

| Command | Behavior |
| --- | --- |
| `luna login install FOLDER --name NAME` | Copy a screen folder into the screen library. Use `--force` to replace it. |
| `luna login list` / `current` | List screens or show the selection. |
| `luna login set NAME` | Select a screen in the configuration. |
| `luna login build OUTPUT` | Write a complete SDDM theme with resolved settings and copied background media. |
| `luna login preview` | Build and open the selected screen in SDDM test mode. |
| `luna login activate` | Build and deploy the selected screen for the next greeter. Requires administrator access. |
| `luna login get-config [KEY]` | Read effective login configuration. |
| `luna login update-config JSON` | Validate and save a configuration patch. |
| `luna login get-config-file` / `dir` | Print the config path or screen library path. |

Activation does not restart SDDM or end the desktop session. Direct config edits,
theme changes, and screen selection need another build/activation; there are no
file watchers.

## Configuration

[example.conf](example.conf) lists the defaults. Missing settings use app defaults;
unknown keys are ignored. Invalid known settings fail validation before building.
`colors` and `fonts` override the corresponding [Luna theme roles](../../themes/DOCS.md).
Unspecified roles and `appearance` come from the selected Luna theme when built.

`wallpaper.source` is an absolute local media path or empty for a solid background.
Paths do not expand `~` or variables. `wallpaper.type` is `auto`, `image`, or `video`;
`auto` detects the type during the build. Still images and GIF/WebP animations use
Qt image decoding. Video loops silently through Qt Multimedia.

`wallpaper.fit` supports `fill`, `fit`, `stretch`, `center`, and `tile`. Video uses
the same modes except `tile`, which centers a single video at its native size.
The background color remains visible around fitted media and if playback fails.

## Writing a screen

A screen folder contains `Screen.qml` and any local QML/assets it imports. Install
it with `luna login install ./my-screen --name my-screen`. Screens receive:

```qml
import QtQuick

Item {
    required property var settings
    required property var login
    // Place the screen's background, effects, and controls here.
}
```

`settings` is a plain snapshot with `screen`, `wallpaper`, `colors`, `fonts`, and
`appearance`. Background sources are copied bundle-relative paths; fonts are
family names. The host loads the selected screen with both required properties.
Screens own their background, effects, layout, and navigation. Import `".." as Luna`
to use `Luna.Background { wallpaper: settings.wallpaper }` for shared image/video
playback. Screens use normal Qt 6 QML modules available to SDDM.

| Controller API | Contract |
| --- | --- |
| `users`, `sessions` | SDDM models; `name` is the account/session label. |
| `selectedUser`, `selectedSession` | Initial last account/session, writable by the screen. |
| `submit(username, password, sessionIndex)` | Pass credentials directly to SDDM. Return whether an attempt was started. Empty passwords are allowed. |
| `busy`, `errorMessage`, `clearError()` | Disable repeated submission and show validation/authentication errors. |
| `authenticationFailed()`, `authenticationSucceeded()` | Clear password inputs and restore focus on failure. Success keeps controls busy until SDDM opens the session. |
| `capsLock` | Current keyboard Caps Lock state. |
| `canPowerOff`, `canReboot`, `canSuspend`, `canHibernate` | SDDM capabilities. |
| `powerOff()`, `reboot()`, `suspend()`, `hibernate()` | Request a supported action when authentication is idle. |

Screens own their password fields and must clear their text and undo history
after submission and authentication signals. Authentication remains with SDDM and
PAM. Install screens only from trusted sources: QML executes in the greeter.

The app lives in `$XDG_DATA_HOME/luna-next/login/app`, with installed screens in
`$XDG_DATA_HOME/luna-next/login/screens`. Built themes contain their own settings
and media, so SDDM does not need access to a user's home directory.

The bundled screen opens with a clock, date, and background blurred according to
the theme's blur settings. Any key reveals the account/avatar and password form;
Escape returns to the welcome view and clears the password. The bottom bar holds
the desktop session selector and supported power actions. `Console login` shows
the system's Ctrl+Alt+F3 shortcut; signing into that console uses normal system
authentication.

## Tests

```sh
python3 -m unittest discover -s src/luna-login/tests -v
cargo test -p luna-next --test login
cargo test -p ln-cli
```

QML tests need Qt 6 Quick Test; set `QMLTESTRUNNER` when it is outside the usual
Qt 6 binary directory. They run offscreen with fake SDDM users, sessions, and
authentication. They never log in, change a live theme, or request host power
actions. Video coverage needs Qt Multimedia and FFmpeg; it is skipped when they
are unavailable. Offscreen tests do not prove hardware video decoding, blur
appearance, or a real PAM flow.
