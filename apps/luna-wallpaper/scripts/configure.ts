#!/usr/bin/env bun
import { mkdir, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { copyTree } from "../../../packages/luna-api/src/lib/tree.ts";
import { ordinaryParents } from "../../../packages/luna-api/src/lib/paths.ts";

const app = resolve(import.meta.dir, "..");
const source = await realpath(join(app, "../../src/luna-wallpaper/src/shell"));
const generated = join(app, "generated/shell");
await ordinaryParents(generated);
await mkdir(dirname(generated), { recursive: true });
await rm(generated, { recursive: true, force: true });
await copyTree(source, generated);
// Bundle the API-backed watcher so installed QML does not depend on checkout imports.
const watcher = await Bun.build({
  entrypoints: [join(source, "../watch.ts")],
  outdir: generated,
  naming: "watch.js",
  target: "bun",
});
if (!watcher.success)
  throw new AggregateError(watcher.logs, "Could not build the wallpaper watcher");
