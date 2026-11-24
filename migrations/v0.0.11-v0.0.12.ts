#!/usr/bin/env bun
import { Luna } from "../packages/luna-api/src/index.ts";

const installed = await Luna.apps.installed(["luna-bar"]);
if (!installed.succes) throw new Error(installed.errMessage);

if (installed.data.includes("luna-bar")) {
  // Install the panel's brightness, audio-routing and Bluetooth-pairing dependencies,
  // then replace its owned settings/QML. The configure hook refreshes a running bar
  // and leaves a stopped one stopped. Repeating this step is safe.
  const result = await Luna.apps.install(["luna-bar"], { closeApps: false });
  if (!result.succes) throw new Error(result.errMessage);
}
