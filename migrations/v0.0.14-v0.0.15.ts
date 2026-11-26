#!/usr/bin/env bun
import { Luna } from "../packages/luna-api/src/index.ts";

const installed = await Luna.apps.installed(["luna-lock"]);
if (!installed.succes) throw new Error(installed.errMessage);

if (installed.data.length) {
  // App hooks refuse active locks before replacing runtime files and restart only an idle daemon.
  const result = await Luna.apps.install(["luna-lock"], { closeApps: false });
  if (!result.succes) throw new Error(result.errMessage);
}
