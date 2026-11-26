# Routing

Links clicked in an installed Luna web app open in the system default browser
unless the destination belongs to an installed app or an allowed sign-in origin.
App membership matches the exact scheme, host and port, including when that app
is visited in an ordinary Luna-profile tab. Other pages and profiles stay untouched.
Mouse, middle-click, Ctrl/Meta-click, Shift-click, new-tab links and keyboard
activation are supported. Successful handoffs leave the app in place without
opening a Chromium tab or window.

The native helper rechecks installed apps before each handoff, validates HTTP(S),
rejects credentials, and invokes `gio open` with one literal URL argument. It refuses
Chromium/Luna web-app default handlers to avoid loops. Choose another default browser;
custom desktop wrappers must also launch outside Luna's profile.

Failed handoffs open a separate Retry tab. Success means the desktop opener accepted the URL,
not that the destination loaded. The helper does not read messages or send data
to a service. If app discovery fails, links retain Chromium's normal behavior.

# Setup

Run `luna configure chromium` to build and install the extension and native helper
in the Luna profile. Configuration closes Chromium and removes Better WhatsApp Web.
Custom Chromium user-data directories are supported.

Additional sign-in origins go in `browserLinks.extraOrigins` in
[`apps/chromium/config/settings.jsonc`](../../apps/chromium/config/settings.jsonc),
then rerun configuration. Google Accounts is included for YouTube sign-in.
These origins remain in Chromium but do not become sources of external-link routing.

App membership is read when each page loads. Reload an already-open page after
installing a web app. The helper checks membership again before opening links from
removed apps. Apps in a custom `--data-dir` are not recognized by this profile's helper.

# Limits

- Typed/pasted URLs, bookmarks, manually opened tabs, page-script navigation,
  context-menu commands, forms, downloads, named-frame links and links inside
  embedded frames retain Chromium's normal behavior.
- Only HTTP(S) anchor links are routed. Custom schemes and blob URLs stay local.
- Links clicked before app discovery finishes stay in Chromium. Pages with custom
  click handlers may need testing against live accounts.
- Existing tabs and cookies are not migrated to another browser.

# Checks

```sh
bun run --cwd packages/luna-browser-links check
bun run --cwd packages/luna-browser-links build
bun test packages/luna-browser-links/tests packages/luna-api/tests/browser-links.test.ts
bun test __tests__/apps/chromium/setup.test.ts
```

The standalone build produces browser files and the Bun helper in `dist`.
Use Chromium configuration to install them and register the native host.
