#!/usr/bin/env bun
import { mkdir, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Luna } from "../../../packages/luna-api/src/index.ts";
import { copyTree } from "../../../packages/luna-api/src/lib/tree.ts";
import { ordinaryParents } from "../../../packages/luna-api/src/lib/paths.ts";

// Never replace a shell that owns an active session lock.
const state = await Luna.lock.status();
if (!state.succes) throw new Error(state.errMessage);
if (state.data.status === "locked" || state.data.status === "locking")
  throw new Error("Unlock the session before configuring Luna Lock");

const app = resolve(import.meta.dir, "..");
const source = await realpath(join(app, "../../src/luna-lock/src/shell"));
const generated = join(app, "generated/shell");
await ordinaryParents(generated);
await mkdir(dirname(generated), { recursive: true });
await rm(generated, { recursive: true, force: true });
await copyTree(source, generated);
