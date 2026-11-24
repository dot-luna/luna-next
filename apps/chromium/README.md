# Ungoogled Chromium

Luna uses **Ungoogled Chromium**, not standard Chromium or Google Chrome.
I don't fucking want Google's bundled shit on this desktop.

One installation and one Chromium desktop entry. A **Luna** profile holds our PWA
customizations; Default and other profiles keep their own settings. New Luna
profiles take their display name from global Git `user.name`; existing profiles
are not recreated or renamed.

This whole Chromium setup exists because fucking Zen doesn't support the native
PWA workflow I need on Linux.

Firefox's [built-in web apps are Windows-only](https://support.mozilla.org/en-US/kb/web-apps-firefox-windows).
[Native PWA support in Zen](https://github.com/zen-browser/desktop/discussions/14454)
remains a feature request.

Configuration builds and installs [Luna Browser Links](../../packages/luna-browser-links/DOCS.md) locally in the Luna
profile. External links clicked in installed web apps open in your default browser;
manual navigation and other pages stay in Chromium. Configuration removes the retired
Better WhatsApp Web extension.
Run `luna configure chromium` after changing extension sources or sign-in origins.
Configuration recovers verified stale profile locks left after Chromium exits.
Active or unverifiable locks still require Chromium to be closed first.
