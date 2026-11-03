#!/usr/bin/env bun
import { Luna } from "../../../packages/luna-api/src/index.ts";

// Restart only idle instances; the API also refuses a lock acquired since preflight.
const state = await Luna.lock.status();
if (!state.succes) throw new Error(state.errMessage);
if (state.data.running) {
  const restarted = await Luna.lock.restart();
  if (!restarted.succes) throw new Error(restarted.errMessage);
}
