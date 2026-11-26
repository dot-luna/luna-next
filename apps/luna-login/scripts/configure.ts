#!/usr/bin/env bun
import { mkdir, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { copyTree } from "../../../packages/luna-api/src/lib/tree.ts";
import { ordinaryParents } from "../../../packages/luna-api/src/lib/paths.ts";
import { loginTemplate } from "../../../packages/luna-api/src/modules/login/template.ts";

const app = resolve(import.meta.dir, "..");
const source = await realpath(join(app, "../../src/luna-login/src"));
const generated = join(app, "generated");
await ordinaryParents(generated);
await rm(generated, { recursive: true, force: true });
await mkdir(generated, { recursive: true });
await copyTree(source, join(generated, "source"));
const settings = await loginTemplate.resolve({
  template: Bun.JSONC.parse(await Bun.file(join(app, "config/login.jsonc")).text()),
});
await Bun.write(join(generated, "login.jsonc"), JSON.stringify(settings, null, 2) + "\n");
