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

test("wallpaper installs its JSONC and QML exports, declares media dependencies, and refreshes only a running renderer", async () => {
  const f = new AppFixture();
  try {
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    const app = join(f.repository, "apps/luna-wallpaper");
    mkdirSync(app, { recursive: true });
    cpSync(join(repo, "apps/luna-wallpaper/app.jsonc"), join(app, "app.jsonc"));
    for (const directory of ["scripts", "config"]) {
      cpSync(join(repo, "apps/luna-wallpaper", directory), join(app, directory), {
        recursive: true,
      });
    }
    cpSync(
      join(repo, "src/luna-wallpaper/src/shell"),
      join(f.repository, "src/luna-wallpaper/src/shell"),
      { recursive: true },
    );
    symlinkSync(join(repo, "packages"), join(f.repository, "packages"));
    f.write(f.repository, "apps/apps.jsonc", '{"packages":["luna-wallpaper/app.jsonc"]}');
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
  console.log('ready');
} else if(args[0]==='kill')rmSync(running);
else if(args.includes('--daemonize'))writeFileSync(running, Bun.env.LUNA_WALLPAPER_SETTINGS);
else process.exit(2);
`,
    );
    chmodSync(join(f.bin, "qs"), 0o755);
    const configRoot = join(f.root, "luna-config");
    f.env.LUNA_CONFIG_HOME_DIR = configRoot;
    f.write(configRoot, "unrelated/value", "keep");
    const options = { repository: f.repository, env: f.env };
    const installed = await Luna.apps.install(["luna-wallpaper"], options);
    expect(installed).toMatchObject({
      succes: true,
      data: { installed: ["luna-wallpaper"], completed: true },
    });
    const destination = join(configRoot, "wallpaper");
    const config = join(configRoot, "wallpaper.jsonc");
    expect(readFileSync(join(destination, "shell.qml"), "utf8")).toContain(
      "LUNA_WALLPAPER_SETTINGS",
    );
    expect(readFileSync(config, "utf8")).toBe(
      readFileSync(join(app, "config/wallpaper.jsonc"), "utf8"),
    );
    expect(readFileSync(qsLog, "utf8")).not.toContain("--daemonize");
    for (const dependency of ["quickshell", "ffmpeg", "qt6-svg", "qt6-imageformats"]) {
      expect(
        f
          .commands()
          .some((command) => command.name === "sudo" && command.args.includes(dependency)),
      ).toBe(true);
    }
    expect(
      f.commands().some((command) => command.name === "yay" && command.args.includes("mpvpaper")),
    ).toBe(true);
    expect(readFileSync(join(configRoot, "aliases/luna-wallpaper.zsh"), "utf8")).toContain("luna");
    f.write(configRoot, "wallpaper/stale.qml", "remove");
    writeFileSync(config, '{"wallpaper":{"source":"/old/image.png"}}');
    writeFileSync(running, "running");
    const updated = join(f.repository, "src/luna-wallpaper/src/shell/Wallpaper.js");
    const source = readFileSync(updated, "utf8") + "\n// refreshed export\n";
    writeFileSync(updated, source);
    expect(await Luna.apps.configure(["luna-wallpaper"], options)).toMatchObject({
      succes: true,
      data: ["luna-wallpaper"],
    });
    expect(await Bun.file(join(destination, "stale.qml")).exists()).toBe(false);
    expect(readFileSync(join(destination, "Wallpaper.js"), "utf8")).toBe(source);
    expect(readFileSync(config, "utf8")).toBe(
      readFileSync(join(app, "config/wallpaper.jsonc"), "utf8"),
    );
    expect(readFileSync(join(configRoot, "unrelated/value"), "utf8")).toBe("keep");
    expect(JSON.parse(readFileSync(running, "utf8"))).toMatchObject({
      wallpaper: { source: "", fit: "fill", background_color: "#000000" },
      playback: { pause_when_output_inactive: true },
      transition: { type: "fade", duration_ms: 200 },
    });
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
