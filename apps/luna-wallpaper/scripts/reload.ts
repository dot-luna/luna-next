#!/usr/bin/env bun
import { Luna } from "../../../packages/luna-api/src/index.ts";

// A process restart picks up replaced QML exports; leave a stopped renderer stopped.
const state = await Luna.wallpaper.status();
if (!state.succes) throw new Error(state.errMessage);
if (state.data.running) {
  const restarted = await Luna.wallpaper.restart();
  if (!restarted.succes) throw new Error(restarted.errMessage);
}
