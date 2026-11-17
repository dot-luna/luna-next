#!/usr/bin/env bun
import { Luna } from "../packages/luna-api/src/index.ts";

// Refresh only the menu presentation and Hyprland bindings; no clipboard history is removed.
const result = await Luna.apps.configure(["luna-menu", "hypr"]);
if (!result.succes) throw new Error(result.errMessage);
