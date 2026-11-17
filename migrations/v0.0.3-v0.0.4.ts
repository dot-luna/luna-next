#!/usr/bin/env bun
import { Luna } from "../packages/luna-api/src/index.ts";

// Configure Notify first so the Chromium restart refreshes its notification capabilities.
// Both app recipes replace their declared exports and tolerate retry after partial completion.
for (const name of ["luna-notify", "chromium"]) {
  const result = await Luna.apps.configure([name], {
    onProgress: (message) => console.error(message),
  });
  if (!result.succes) throw new Error(result.errMessage);
}
