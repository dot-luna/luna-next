#!/usr/bin/env bun
import { Luna } from "../packages/luna-api/src/index.ts";

const installed = await Luna.apps.installed(["luna-wallpaper"]);
if (!installed.succes) throw new Error(installed.errMessage);

if (installed.data.includes("luna-wallpaper")) {
  // Rebuild the owned watcher and QML exports; the hook restarts only a running renderer.
  const refreshed = await Luna.apps.configure(["luna-wallpaper"], { closeApps: false });
  if (!refreshed.succes) throw new Error(refreshed.errMessage);
}
