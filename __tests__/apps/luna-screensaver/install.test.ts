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

test("screensaver installs JSONC and shell exports, replaces owned paths, and restarts only a running instance hidden", async () => {
  const f = new AppFixture();
  try {
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    const app = join(f.repository, "apps/luna-screensaver");
    mkdirSync(app, { recursive: true });
    cpSync(join(repo, "apps/luna-screensaver/app.jsonc"), join(app, "app.jsonc"));
    for (const directory of ["scripts", "config"])
      cpSync(join(repo, "apps/luna-screensaver", directory), join(app, directory), {
        recursive: true,
      });
    cpSync(
      join(repo, "src/luna-screensaver/src/shell"),
      join(f.repository, "src/luna-screensaver/src/shell"),
      {
        recursive: true,
      },
    );
    symlinkSync(join(repo, "packages"), join(f.repository, "packages"));
    f.write(f.repository, "apps/apps.jsonc", '{"packages":["luna-screensaver/app.jsonc"]}');
    rmSync(join(f.bin, "bun"));
    symlinkSync(process.execPath, join(f.bin, "bun"));
    const running = join(f.root, "qs-running");
    const snapshot = join(f.root, "settings.json");
    const qsLog = join(f.root, "qs.jsonl");
    f.write(
      f.bin,
      "qs",
      `#!${process.execPath}
import {appendFileSync, existsSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
const args=Bun.argv.slice(2);
appendFileSync(${JSON.stringify(qsLog)}, JSON.stringify(args)+'\\n');
const running=${JSON.stringify(running)};
if(args[0]==='ipc') {
  if(!existsSync(running))process.exit(1);
  console.log(readFileSync(running,'utf8'));
} else if(args[0]==='kill')rmSync(running);
else if(args.includes('--daemonize')) {
  writeFileSync(running, 'hidden');
  writeFileSync(${JSON.stringify(snapshot)}, Bun.env.LUNA_SCREENSAVER_SETTINGS);
} else process.exit(2);
`,
    );
    chmodSync(join(f.bin, "qs"), 0o755);
    const configRoot = join(f.root, "luna-config");
    f.env.LUNA_CONFIG_HOME_DIR = configRoot;
    f.write(configRoot, "unrelated/value", "keep");
    const options = { repository: f.repository, env: f.env };
    const installed = await Luna.apps.install(["luna-screensaver"], options);
    expect(installed).toMatchObject({
      succes: true,
      data: { installed: ["luna-screensaver"], completed: true },
    });
    const destination = join(configRoot, "screensaver");
    const config = join(configRoot, "screensaver.jsonc");
    expect(readFileSync(join(destination, "shell.qml"), "utf8")).toContain(
      "LUNA_SCREENSAVER_SETTINGS",
    );
    expect(readFileSync(config, "utf8")).toBe(
      readFileSync(join(app, "config/screensaver.jsonc"), "utf8"),
    );
    expect(readFileSync(qsLog, "utf8")).not.toContain("--daemonize");
    expect(
      f
        .commands()
        .some((command) => command.name === "sudo" && command.args.includes("quickshell")),
    ).toBe(true);
    expect(readFileSync(join(configRoot, "aliases/luna-screensaver.zsh"), "utf8")).toContain(
      "screensaver",
    );

    f.write(configRoot, "screensaver/stale.qml", "remove");
    writeFileSync(config, '{"idle_seconds":10}');
    writeFileSync(running, "visible");
    const updated = join(f.repository, "src/luna-screensaver/src/shell/shell.qml");
    const source = readFileSync(updated, "utf8") + "\n// refreshed export\n";
    writeFileSync(updated, source);
    expect(await Luna.apps.configure(["luna-screensaver"], options)).toMatchObject({
      succes: true,
      data: ["luna-screensaver"],
    });
    expect(await Bun.file(join(destination, "stale.qml")).exists()).toBe(false);
    expect(readFileSync(join(destination, "shell.qml"), "utf8")).toBe(source);
    expect(readFileSync(config, "utf8")).toBe(
      readFileSync(join(app, "config/screensaver.jsonc"), "utf8"),
    );
    expect(readFileSync(join(configRoot, "unrelated/value"), "utf8")).toBe("keep");
    expect(readFileSync(running, "utf8")).toBe("hidden");
    expect(JSON.parse(readFileSync(snapshot, "utf8"))).toEqual({ idle_seconds: 300 });
    const commands = readFileSync(qsLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(commands.some((command) => command[0] === "kill")).toBe(true);
    expect(commands.filter((command) => command.includes("--daemonize"))).toHaveLength(1);
    expect(commands.every((command) => command[command.indexOf("-p") + 1] === destination)).toBe(
      true,
    );
  } finally {
    f.dispose();
  }
});
