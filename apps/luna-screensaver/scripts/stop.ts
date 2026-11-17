#!/usr/bin/env bun
import { join } from "node:path";
import { Luna } from "../../../packages/luna-api/src/index.ts";

// Repeated uninstall/purge calls may find the renderer's files already removed.
if (
  Bun.env.LUNA_CLOSE_APPS !== "0" &&
  (await Bun.file(join(Bun.env.LUNA_CONFIG_HOME_DIR!, "screensaver/shell.qml")).exists())
) {
  const result = await Luna.screensaver.stop();
  if (!result.succes) throw new Error(result.errMessage);
}
