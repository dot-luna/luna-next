#!/usr/bin/env bun
import { Luna } from "../../../packages/luna-api/src/index.ts";

// Refresh an existing menu after its owned export changes; leave a stopped menu stopped.
const state = await Luna.menu.status();
if (!state.succes) throw new Error(state.errMessage);
if (state.data.running) {
  const stopped = await Luna.menu.stop();
  if (!stopped.succes) throw new Error(stopped.errMessage);
  const started = await Luna.menu.start();
  if (!started.succes) throw new Error(started.errMessage);
}
