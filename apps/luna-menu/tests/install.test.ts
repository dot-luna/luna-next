import { expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Luna } from "../../../packages/luna-api/src/index.ts";
import { AppFixture } from "../../../packages/luna-api/tests/fixtures/app-fixture.ts";

test("menu installs through the local app catalog, replaces only its QML export and refreshes a running instance", async () => {
  const f = new AppFixture();
  try {
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    const app = join(f.repository, "apps/luna-menu");
    mkdirSync(app, { recursive: true });
    cpSync(join(repo, "apps/luna-menu/app.jsonc"), join(app, "app.jsonc"));
    cpSync(join(repo, "apps/luna-menu/scripts"), join(app, "scripts"), { recursive: true });
    cpSync(join(repo, "src/luna-menu/src/shell"), join(f.repository, "src/luna-menu/src/shell"), {
      recursive: true,
    });
    symlinkSync(join(repo, "packages"), join(f.repository, "packages"));
    f.write(f.repository, "apps/apps.jsonc", '{"packages":["luna-menu/app.jsonc"]}');
    rmSync(join(f.bin, "bun"));
    symlinkSync(process.execPath, join(f.bin, "bun"));
    const running = join(f.root, "qs-running");
    const qsLog = join(f.root, "qs.jsonl");
    f.write(
      f.bin,
      "qs",
      `#!${process.execPath}
import {appendFileSync, existsSync, writeFileSync, rmSync} from 'node:fs';
const args=Bun.argv.slice(2);
appendFileSync(${JSON.stringify(qsLog)}, JSON.stringify(args)+'\\n');
const running=${JSON.stringify(running)};
if(args[0]==='ipc') {
  if(!existsSync(running))process.exit(1);
  console.log('running');
} else if(args[0]==='kill')rmSync(running);
else if(args.includes('--daemonize'))writeFileSync(running, Bun.env.LUNA_MENU_THEME);
else process.exit(2);
`,
    );
    chmodSync(join(f.bin, "qs"), 0o755);
    f.write(f.home, ".config/luna/unrelated/value", "keep");
    const options = { repository: f.repository, env: f.env };
    const installed = await Luna.apps.install(["menu"], options);
    expect(installed).toMatchObject({
      succes: true,
      data: { installed: ["luna-menu"], completed: true },
    });
    const destination = join(f.home, ".config/luna/menu");
    expect(readFileSync(join(destination, "shell.qml"), "utf8")).toContain("LUNA_MENU_THEME");
    expect(readFileSync(join(destination, "icons/LICENSE.md"), "utf8")).toContain("Hugeicons");
    expect(readFileSync(qsLog, "utf8")).not.toContain("--daemonize");
    expect(f.commands().some((c) => c.name === "sudo" && c.args.includes("quickshell"))).toBe(true);
    expect(
      f.commands().some((c) => c.name === "sudo" && c.args.includes("xdg-terminal-exec")),
    ).toBe(true);
    f.write(f.home, ".config/luna/menu/stale.qml", "remove");
    writeFileSync(running, "running");
    expect(await Luna.apps.configure(["menu"], options)).toMatchObject({
      succes: true,
      data: ["luna-menu"],
    });
    expect(await Bun.file(join(destination, "stale.qml")).exists()).toBe(false);
    expect(readFileSync(join(f.home, ".config/luna/unrelated/value"), "utf8")).toBe("keep");
    expect(JSON.parse(readFileSync(running, "utf8")).fonts.ui).toBeTruthy();
    expect(readFileSync(qsLog, "utf8")).toContain('"kill"');
  } finally {
    f.dispose();
  }
});
