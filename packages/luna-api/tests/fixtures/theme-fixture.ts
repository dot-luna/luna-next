import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ThemeOptions } from "../../src/theme/types.ts";

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export class ThemeFixture {
  root = mkdtempSync(join(tmpdir(), "luna themes ' "));
  home = join(this.root, "home");
  bin = join(this.root, "bin");
  configFile = join(this.root, "config/theme.jsonc");
  libraryDir = join(this.root, "data/themes");
  wallpaperDir = join(this.root, "data/wallpapers");
  env: Record<string, string> = {
    HOME: this.home,
    DBUS_SESSION_BUS_ADDRESS: "fixture:mock-gsettings",
    PATH: this.bin,
    THEME_LOG: join(this.root, "commands"),
    THEME_PREFERENCE: join(this.root, "preference"),
    THEME_MARKER: join(this.root, "failure"),
    THEME_CONFIG: this.configFile,
  };
  options: ThemeOptions = {
    configFile: this.configFile,
    libraryDir: this.libraryDir,
    wallpaperDir: this.wallpaperDir,
    env: this.env,
  };

  constructor() {
    mkdirSync(this.home);
    mkdirSync(this.bin);
    for (const name of ["pacman", "yay", "sudo"]) {
      const mock = resolve(import.meta.dir, "self-command.ts");
      writeFileSync(
        join(this.bin, name),
        `#!${Bun.which("bash")}\nexec ${[process.execPath, mock, name].map(quote).join(" ")} "$@"\n`,
        { mode: 0o755 },
      );
    }
    this.env.SELF_LOG = join(this.root, "packages.jsonl");
    for (const tool of ["bash", "flock", "mv", "file"])
      symlinkSync(Bun.which(tool)!, join(this.bin, tool));
    const command = [process.execPath, resolve(import.meta.dir, "theme-command.ts")]
      .map(quote)
      .join(" ");
    writeFileSync(join(this.bin, "gsettings"), `#!${Bun.which("bash")}\nexec ${command} "$@"\n`, {
      mode: 0o755,
    });
  }
  source(name: string, text = "{}\n") {
    const path = join(this.root, "sources", name);
    this.write(join(path, "theme.jsonc"), text);
    return path;
  }
  write(path: string, contents: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  read(path: string) {
    return readFileSync(path, "utf8");
  }
  dispose() {
    rmSync(this.root, { recursive: true, force: true });
  }
}
