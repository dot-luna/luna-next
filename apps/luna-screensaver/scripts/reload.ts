#!/usr/bin/env bun
import { Luna } from "../../../packages/luna-api/src/index.ts";

// Replaced QML needs a process restart; keep stopped instances stopped.
const state = await Luna.screensaver.status();
if (!state.succes) throw new Error(state.errMessage);
if (state.data.running) {
  const restarted = await Luna.screensaver.restart();
  if (!restarted.succes) throw new Error(restarted.errMessage);
}
