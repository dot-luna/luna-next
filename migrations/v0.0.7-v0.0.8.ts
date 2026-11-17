#!/usr/bin/env bun
import { Luna } from "../packages/luna-api/src/index.ts";

// Replace the changed exports. The menu's configure hook restarts a running menu
// so its QML takes effect immediately; a stopped menu stays stopped.
const result = await Luna.apps.configure(["luna-menu", "hypr"]);
if (!result.succes) throw new Error(result.errMessage);

// Writing Hyprland's files alone does not apply them. Reload this session after
// configuration succeeds; outside Hyprland the next login loads the new files.
if (Bun.env.HYPRLAND_INSTANCE_SIGNATURE) {
  const reload = Bun.spawn(["hyprctl", "reload"], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await reload.exited) !== 0) throw new Error("Failed to reload Hyprland");
}
