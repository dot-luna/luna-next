import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SelfFixture } from "./self-fixture.ts";

/** Real local Git and filesystem exports; package commands and app hooks stay isolated. */
export class AppFixture extends SelfFixture {
  entries: string[] = [];
  constructor() {
    super();
    this.env.SELF_INSTALLED_JSON = join(this.root, "installed.json");
    this.env.APP_LOG = join(this.root, "hooks.jsonl");
    this.env.CHROME_LOG = join(this.root, "chromium.json");
    writeFileSync(this.executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    chmodSync(this.executable, 0o755);
  }
  app(id: string, manifest: Record<string, unknown>, hooks: string[] = []) {
    const recipe = {
      ...manifest,
      hooks: Object.fromEntries(hooks.map((stage) => [stage, [`hooks/${stage}.ts`]])),
    };
    for (const stage of hooks) {
      const path = `apps/${id}/hooks/${stage}.ts`;
      this.write(
        this.repository,
        path,
        `#!${process.execPath}\nimport {appendFileSync, mkdirSync, writeFileSync} from "node:fs";\nimport {join} from "node:path";\nappendFileSync(process.env.APP_LOG!,JSON.stringify({app:${JSON.stringify(id)},stage:${JSON.stringify(stage)},cwd:process.cwd(),version:process.env.LUNA_PACKAGE_VERSION})+"\\n");\nif(process.env.APP_FAIL===${JSON.stringify(id + ":" + stage)})process.exit(7);\nif(${JSON.stringify(stage)}==="build"&&process.env.LUNA_PACKAGE_VERSION) { const file=join(process.env.LUNA_GIT_APP_INSTALL_DIR!,${JSON.stringify(id)}); mkdirSync(join(file,".."),{recursive:true});writeFileSync(file,process.env.LUNA_PACKAGE_VERSION); }\n`,
      );
      chmodSync(join(this.repository, path), 0o755);
    }
    this.write(this.repository, `apps/${id}/app.jsonc`, JSON.stringify(recipe));
    this.entries.push(`${id}/app.jsonc`);
    this.write(this.repository, "apps/apps.jsonc", JSON.stringify({ packages: this.entries }));
  }
  hooks(): { app: string; stage: string; cwd: string; version?: string }[] {
    try {
      return readFileSync(this.env.APP_LOG!, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }
  browser() {
    this.write(this.home, ".config/chromium/Luna/Preferences", "{}");
    const path = join(this.bin, "chromium");
    writeFileSync(
      path,
      `#!${process.execPath}\nawait Bun.write(process.env.CHROME_LOG!,JSON.stringify(Bun.argv.slice(2)));\n`,
      { mode: 0o755 },
    );
  }
}
