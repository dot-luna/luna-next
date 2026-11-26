#!/usr/bin/env bun
import { Luna, type ApiResponse } from "../packages/luna-api/src/index.ts";

function check<T>(response: ApiResponse<T>): T {
  if (!response.succes) throw new Error(response.errMessage);
  return response.data;
}

// Refresh only apps this system has; apps enabled by default in this release are not added.
const installed = new Set(
  check(await Luna.apps.installed(["hypr", "fastfetch", "luna-bar", "t3code", "zen", "chromium"])),
);
const configure = (names: string[], closeApps = true) => {
  const selected = names.filter((name) => installed.has(name));
  return selected.length ? Luna.apps.configure(selected, { closeApps }) : undefined;
};

// Super+Shift+F opens the file explorer and Super+Shift+Space toggles the bar; About
// (Fastfetch) moves to Super+Shift+A. Both are Hyprland includes, reloaded below.
const shortcuts = await configure(["hypr", "fastfetch"]);
if (shortcuts) check(shortcuts);

// Reload the current session so the shortcuts work now; otherwise they apply at login.
if (Bun.env.HYPRLAND_INSTANCE_SIGNATURE) {
  const reload = Bun.spawn(["hyprctl", "reload"], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await reload.exited) !== 0) throw new Error("Failed to reload Hyprland");
}

// The bar's export now includes bar.jsonc. Its after_configure hook restarts a running
// bar with the new renderer; a stopped bar stays stopped.
const bar = await configure(["luna-bar"]);
if (bar) check(bar);

// GTK keeps its native rounded controls and only takes Luna's colors and fonts. Saving
// the effective mode regenerates and republishes the GTK stylesheet without changing it.
check(await Luna.theme.mode(check(await Luna.theme.mode())));

// T3 Code now applies Luna's theme after configuration. The hook only writes T3's
// settings, so T3 Code keeps running.
const t3 = await configure(["t3code"], false);
if (t3) check(t3);

// Zen styles its popups and built-in pages from the theme; Chromium drops Better WhatsApp
// Web and routes only links clicked in installed web apps. Both close while configuring.
const browsers = await configure(["zen", "chromium"]);
if (browsers) check(browsers);
