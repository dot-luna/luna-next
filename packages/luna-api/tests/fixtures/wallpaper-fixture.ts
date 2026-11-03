import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Isolate native renderer control while keeping JSONC, locks, writes, and recovery real. */
export class WallpaperFixture {
  root = mkdtempSync(join(tmpdir(), "luna wallpaper ' "));
  bin = join(this.root, "bin");
  configHome = join(this.root, "config/luna");
  configFile = join(this.configHome, "wallpaper.jsonc");
  shell = join(this.configHome, "wallpaper");
  env: Record<string, string> = {
    HOME: this.root,
    PATH: this.bin,
    XDG_CONFIG_HOME: join(this.root, "config"),
    LUNA_TEST_STATE: join(this.root, "state.json"),
    LUNA_TEST_COMMANDS: join(this.root, "commands.jsonl"),
    LUNA_TEST_CONFIG: this.configFile,
  };
  get options() {
    return { env: this.env };
  }
  constructor() {
    this.write(join(this.shell, "shell.qml"), "// fixture\n");
    mkdirSync(this.bin);
    for (const name of ["flock", "bash"]) symlinkSync(Bun.which(name)!, join(this.bin, name));
    this.write(
      join(this.bin, "qs"),
      `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = Bun.argv.slice(2);
appendFileSync(Bun.env.LUNA_TEST_COMMANDS, JSON.stringify({args, snapshot: Bun.env.LUNA_WALLPAPER_SETTINGS}) + '\\n');
const file = Bun.env.LUNA_TEST_STATE;
let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {running: false};
if (args.includes('--daemonize')) {
  if (Bun.env.LUNA_TEST_START_FAIL) { console.error('startup fixture failure'); process.exit(7); }
  state = {running: true, settings: JSON.parse(Bun.env.LUNA_WALLPAPER_SETTINGS), status: 'ready', readyAt: Date.now() + Number(Bun.env.LUNA_TEST_READY_DELAY || 0)};
} else if (args[0] === 'kill') state.running = false;
else if (args[0] === 'ipc') {
  if (!state.running) process.exit(1);
  const marker = args.indexOf('--');
  if (marker < 0 || args[marker + 1] !== 'wallpaper') process.exit(2);
  const method = args[marker + 2];
  if (method === 'status') {
    if (Date.now() < state.readyAt) console.log('loading');
    else if (state.loading) { state.loading--; console.log('loading'); }
    else console.log(state.status);
  } else if (method === 'snapshot') {
    console.log(JSON.stringify(state.settings));
  } else if (method === 'reload') {
    const settings = JSON.parse(args[marker + 3]);
    const broken = settings.wallpaper?.source?.includes('broken');
    if (broken && Bun.env.LUNA_TEST_EXTERNAL) writeFileSync(Bun.env.LUNA_TEST_CONFIG, Bun.env.LUNA_TEST_EXTERNAL);
    if (broken && Bun.env.LUNA_TEST_REJECT) console.log('error: fixture rejection');
    else {
      state.settings = settings;
      state.status = broken ? 'error' : 'ready';
      state.loading = broken ? 0 : 2;
      console.log('ok');
    }
  } else process.exit(3);
} else process.exit(4);
writeFileSync(file, JSON.stringify(state));
`,
      0o755,
    );
  }
  write(path: string, source: string, mode?: number) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source, mode ? { mode } : undefined);
  }
  source(text: string) {
    this.write(this.configFile, text);
  }
  read() {
    return readFileSync(this.configFile, "utf8");
  }
  state() {
    return JSON.parse(readFileSync(this.env.LUNA_TEST_STATE!, "utf8"));
  }
  commands(): { args: string[]; snapshot?: string }[] {
    try {
      return readFileSync(this.env.LUNA_TEST_COMMANDS!, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }
  dispose() {
    rmSync(this.root, { recursive: true, force: true });
  }
}
