#!/usr/bin/env bun
import { Luna } from "../packages/luna-api/src/index.ts";

// Refresh Luna's input settings while retaining the native config's gesture bindings.
const configured = await Luna.apps.configure(["hypr"]);
if (!configured.succes) throw new Error(configured.errMessage);

// Apply the gesture fix to an existing session; otherwise it takes effect at login.
if (Bun.env.HYPRLAND_INSTANCE_SIGNATURE) {
  const reload = Bun.spawn(["hyprctl", "reload"], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await reload.exited) !== 0) throw new Error("Failed to reload Hyprland");
}
