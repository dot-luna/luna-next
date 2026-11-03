#!/usr/bin/env bun
import { mkdir, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { copyTree } from "../../../packages/luna-api/src/lib/tree.ts";
import { ordinaryParents } from "../../../packages/luna-api/src/lib/paths.ts";

const app = resolve(import.meta.dir, "..");
const source = await realpath(join(app, "../../src/luna-screensaver/src/shell"));
const generated = join(app, "generated/shell");
await ordinaryParents(generated);
await mkdir(dirname(generated), { recursive: true });
await rm(generated, { recursive: true, force: true });
await copyTree(source, generated);
