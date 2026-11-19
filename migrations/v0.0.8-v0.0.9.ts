#!/usr/bin/env bun
import { Luna } from "../packages/luna-api/src/index.ts";

// Install the new bar and its renderer, then refresh login startup and Super+B.
const installed = await Luna.apps.install(["luna-bar"]);
if (!installed.succes) throw new Error(installed.errMessage);
const configured = await Luna.apps.configure(["hypr"]);
if (!configured.succes) throw new Error(configured.errMessage);

if (Bun.env.HYPRLAND_INSTANCE_SIGNATURE) {
  const reload = Bun.spawn(["hyprctl", "reload"], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await reload.exited) !== 0) throw new Error("Failed to reload Hyprland");
  // This release adds a visible session app; existing sessions need it started too.
  const started = await Luna.bar.start();
  if (!started.succes) throw new Error(started.errMessage);
}
