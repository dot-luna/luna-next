# Routing

The Luna profile routes top-level HTTP(S) GET navigations to the system default
browser, including normal links, new tabs, page-script popups and typed URLs.
Installed Luna web-app origins stay in Chromium; scheme, host and port must match.
Resources and frames inside those apps are unaffected. Existing page history is
restored after opening a same-tab external link; a new routing tab closes itself.

The local native helper reads installed web-app metadata and uses `gio open` with
the URL as one literal argument. It validates HTTP(S), rejects credentials, and
refuses Chromium/Luna web-app desktop IDs as default handlers to avoid routing loops.
Choose another default browser before enabling this extension. A custom desktop
wrapper must also launch outside Luna's profile.

Failed handoffs show an error with Retry. A success means the desktop opener
accepted the URL, not that the destination finished loading. The helper does not
read messages or send data to a service.

# Setup

`luna configure chromium` builds both local extensions and the native helper, then
installs them only in the Luna profile. `luna self update` from v0.0.3 runs the same
setup through the v0.0.4 migration. Bun, GIO (glib2), and xdg-utils are included in
Luna setup. Custom Chromium user-data directories are supported.

Additional sign-in origins go in `browserLinks.extraOrigins` in
[`apps/chromium/config/settings.jsonc`](../../apps/chromium/config/settings.jsonc),
then rerun configuration. Google Accounts is included for YouTube sign-in.
Other external sign-in providers need their origins listed or will open in the
default browser, where that sign-in cannot establish the app's Chromium session.

New web apps are recognized when first opened. Removed origins stop being allowed
after Chromium restarts or the next external handoff refreshes the rules.
Apps stored in a custom `--data-dir` need their origins added explicitly.

# Limits

- This is profile-wide, not a setting for the whole Chromium installation.
- POST navigations stay in Chromium because a request body cannot be handed to a
  different browser. `mailto:`, custom schemes, local files and downloads generated
  as blobs retain the browser's normal handling. External GET download links go to
  the default browser.
- Apps with a service worker may handle a navigation before Chromium's network
  rules see it. Site-specific behavior still needs testing against live accounts.
- It does not migrate existing tabs or cookies into another browser.

# Checks

```sh
bun run --cwd packages/luna-browser-links check
bun run --cwd packages/luna-browser-links build
bun test packages/luna-browser-links/tests packages/luna-api/tests/browser-links.test.ts
bun test __tests__/apps/chromium/setup.test.ts
```

The standalone build produces the browser files and Bun helper in `dist`. Use
Chromium configuration for installation; it registers the native host and builds
the routing rules for the installed extension's identity.
