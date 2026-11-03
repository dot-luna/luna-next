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

test("lock exports replace owned paths, restart idle daemons, and refuse active locks before writes", async () => {
  const f = new AppFixture();
  try {
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    const app = join(f.repository, "apps/luna-lock");
    mkdirSync(app, { recursive: true });
    cpSync(join(repo, "apps/luna-lock/app.jsonc"), join(app, "app.jsonc"));
    for (const directory of ["scripts", "config"])
      cpSync(join(repo, "apps/luna-lock", directory), join(app, directory), { recursive: true });
    cpSync(join(repo, "src/luna-lock/src/shell"), join(f.repository, "src/luna-lock/src/shell"), {
      recursive: true,
    });
    symlinkSync(join(repo, "packages"), join(f.repository, "packages"));
    f.write(f.repository, "apps/apps.jsonc", '{"packages":["luna-lock/app.jsonc"]}');
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
  const method=args[args.indexOf('lock')+1];
  if(method==='status')console.log(readFileSync(running,'utf8'));
  else if(method==='stop'&&readFileSync(running,'utf8')==='idle') { rmSync(running);console.log('ok'); }
  else process.exit(2);
} else if(args.includes('--daemonize')) {
  writeFileSync(running, 'idle');
  writeFileSync(${JSON.stringify(snapshot)}, Bun.env.LUNA_LOCK_SETTINGS);
} else process.exit(2);
`,
    );
    chmodSync(join(f.bin, "qs"), 0o755);
    const configRoot = join(f.root, "luna-config");
    f.env.LUNA_CONFIG_HOME_DIR = configRoot;
    f.write(configRoot, "unrelated/value", "keep");
    const options = { repository: f.repository, env: f.env };
    const installed = await Luna.apps.install(["luna-lock"], options);
    expect(installed).toMatchObject({
      succes: true,
      data: { installed: ["luna-lock"], completed: true },
    });
    const destination = join(configRoot, "lock");
    const config = join(configRoot, "lock.jsonc");
    expect(readFileSync(join(destination, "shell.qml"), "utf8")).toContain("LUNA_LOCK_SETTINGS");
    const defaults = readFileSync(join(app, "config/lock.jsonc"), "utf8");
    expect(readFileSync(config, "utf8")).toBe(defaults);
    expect(readFileSync(qsLog, "utf8")).not.toContain("--daemonize");
    expect(
      f
        .commands()
        .some((command) => command.name === "sudo" && command.args.includes("quickshell")),
    ).toBe(true);
    expect(readFileSync(join(configRoot, "aliases/luna-lock.zsh"), "utf8")).toContain("lock");

    f.write(configRoot, "lock/stale.qml", "remove");
    writeFileSync(config, '{"idle_seconds":10,"dpms_seconds":5}');
    writeFileSync(running, "idle");
    const updated = join(f.repository, "src/luna-lock/src/shell/shell.qml");
    const source = readFileSync(updated, "utf8") + "\n// refreshed export\n";
    writeFileSync(updated, source);
    expect(await Luna.apps.configure(["luna-lock"], options)).toMatchObject({
      succes: true,
      data: ["luna-lock"],
    });
    expect(await Bun.file(join(destination, "stale.qml")).exists()).toBe(false);
    expect(readFileSync(join(destination, "shell.qml"), "utf8")).toBe(source);
    expect(readFileSync(config, "utf8")).toBe(defaults);
    expect(readFileSync(join(configRoot, "unrelated/value"), "utf8")).toBe("keep");
    expect(readFileSync(running, "utf8")).toBe("idle");
    expect(JSON.parse(readFileSync(snapshot, "utf8"))).toEqual({
      idle_seconds: 600,
      dpms_seconds: 30,
    });

    f.write(configRoot, "lock/custom.qml", "preserve while locked");
    writeFileSync(config, '{"idle_seconds":9}');
    for (const state of ["locking", "locked"]) {
      writeFileSync(running, state);
      const result = await Luna.apps.configure(["luna-lock"], options);
      expect(result).toMatchObject({ succes: false });
      if (!result.succes) expect(result.errMessage).toContain("Unlock the session");
      expect(readFileSync(running, "utf8")).toBe(state);
      expect(readFileSync(join(destination, "custom.qml"), "utf8")).toBe("preserve while locked");
      expect(readFileSync(config, "utf8")).toBe('{"idle_seconds":9}');
    }
    const commands = readFileSync(qsLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(commands.some((command) => command[0] === "kill")).toBe(false);
    expect(commands.filter((command) => command.includes("--daemonize"))).toHaveLength(1);
    expect(commands.every((command) => command[command.indexOf("-p") + 1] === destination)).toBe(
      true,
    );
  } finally {
    f.dispose();
  }
});
