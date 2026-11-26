#!/usr/bin/env bun
import { Luna } from "../../../packages/luna-api/src/index.ts";

const state = await Luna.polkit.status();
if (!state.succes) throw new Error(state.errMessage);
if (state.data.running) {
  const restarted = await Luna.polkit.restart();
  if (!restarted.succes) throw new Error(restarted.errMessage);
}
