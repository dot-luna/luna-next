import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const app = fileURLToPath(new URL("../", import.meta.url));
export const fixtures = join(app, "tests/fixtures");
export const quickshell = Bun.which("qs") ?? Bun.which("quickshell");

/** Each instance owns a private offscreen shell, runtime directory, and process group. */
export class ShellHarness {
  readonly root = mkdtempSync(join(tmpdir(), "luna-wp-"));
  readonly renderer = join(this.root, "shell");
  readonly logPath = join(this.root, "shell.log");
  readonly bin = join(this.root, "bin");
  readonly env: Record<string, string>;
  process: ReturnType<typeof Bun.spawn> | null = null;

  constructor() {
    const runtime = join(this.root, "runtime");
    mkdirSync(runtime, { mode: 0o700 });
    for (const directory of [this.renderer, this.bin, join(this.root, "home")])
      mkdirSync(directory);
    this.env = {
      ...Object.fromEntries(
        Object.entries(Bun.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      QT_QPA_PLATFORM: "offscreen",
      QS_NO_RELOAD_POPUP: "1",
      HOME: join(this.root, "home"),
      XDG_RUNTIME_DIR: runtime,
      XDG_CONFIG_HOME: join(this.root, "config"),
      XDG_CACHE_HOME: join(this.root, "cache"),
      XDG_DATA_HOME: join(this.root, "data"),
      XDG_STATE_HOME: join(this.root, "state"),
      DBUS_SYSTEM_BUS_ADDRESS: "unix:path=/nonexistent-wallpaper-test-bus",
    };
    for (const key of [
      "WAYLAND_DISPLAY",
      "DISPLAY",
      "HYPRLAND_INSTANCE_SIGNATURE",
      "QT_LOGGING_RULES",
      "QT_SCALE_FACTOR",
      "LUNA_WALLPAPER_CONFIG",
      "LUNA_WALLPAPER_SETTINGS",
      "LUNA_WALLPAPER_WATCH_COMMAND",
      "LUNA_CONFIG_HOME_DIR",
      "LUNA_DATA_HOME_DIR",
      "LUNA_STATE_HOME_DIR",
    ])
      delete this.env[key];
  }

  write(path: string, contents: string | Uint8Array, mode?: number) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents, { mode });
  }

  script(name: string, source: string) {
    this.write(join(this.bin, name), `#!${process.execPath}\n${source}`, 0o755);
    this.env.PATH = `${this.bin}:${Bun.env.PATH}`;
  }

  async launch(cwd = this.root) {
    await this.stop();
    const log = openSync(this.logPath, "w");
    try {
      this.process = Bun.spawn([quickshell!, "-p", this.renderer], {
        env: this.env,
        cwd,
        stdout: log,
        stderr: log,
        detached: true,
      });
    } finally {
      closeSync(log);
    }
    await this.until(async () => (await this.ipc("state", [], "test", false)).startsWith("{"));
  }

  async ipc(
    method: string,
    args: (string | number | boolean)[] = [],
    target = "test",
    check = true,
  ) {
    const child = Bun.spawn(
      [quickshell!, "ipc", "-p", this.renderer, "call", target, method, ...args.map(String)],
      {
        env: this.env,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 3000,
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (check && code !== 0)
      throw new Error(`IPC ${target}.${method} failed (${code}): ${stderr}\n${this.log()}`);
    return stdout.trim();
  }

  async state<T = Record<string, unknown>>(): Promise<T> {
    return JSON.parse(await this.ipc("state"));
  }

  async until(predicate: () => unknown | Promise<unknown>, timeout = 5000) {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
      if (await predicate()) return;
      if (this.process && this.process.exitCode !== null) break;
      await Bun.sleep(25);
    }
    throw new Error(`Wallpaper condition failed:\n${this.log()}`);
  }

  private log() {
    return existsSync(this.logPath) ? readFileSync(this.logPath, "utf8") : "";
  }

  async stop() {
    const child = this.process;
    if (!child) return;
    const signal = (value: NodeJS.Signals) => {
      try {
        process.kill(-child.pid, value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    signal("SIGTERM");
    if (
      (await Promise.race([child.exited.then(() => true), Bun.sleep(2000).then(() => false)])) ===
      false
    ) {
      signal("SIGKILL");
      await child.exited;
    }
    this.process = null;
  }

  async dispose() {
    await this.stop();
    rmSync(this.root, { recursive: true, force: true });
  }
}
