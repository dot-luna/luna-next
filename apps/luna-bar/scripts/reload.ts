#!/usr/bin/env bun
import { Luna } from "../../../packages/luna-api/src/index.ts";

// Refresh an existing bar after its owned export changes; leave a stopped bar stopped.
const state = await Luna.bar.status();
if (!state.succes) throw new Error(state.errMessage);
if (state.data.running) {
  const started = await Luna.bar.restart();
  if (!started.succes) throw new Error(started.errMessage);
}
