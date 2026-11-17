#!/usr/bin/env bun
import { Luna } from "../packages/luna-api/src/index.ts";

// Refresh menu dependencies/sources and Hyprland shortcuts, startup and Calculator rules.
// App exports replace their owned files, and watcher startup tolerates repeated calls.
const menu = await Luna.apps.install(["luna-menu"]);
if (!menu.succes) throw new Error(menu.errMessage);

const hypr = await Luna.apps.configure(["hypr"]);
if (!hypr.succes) throw new Error(hypr.errMessage);

if (Bun.env.WAYLAND_DISPLAY) {
  const clipboard = await Luna.clipboard.start();
  if (!clipboard.succes) throw new Error(clipboard.errMessage);
}
