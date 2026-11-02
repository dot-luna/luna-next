import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "pathe";
import { InstallContext } from "../../src/self/install/command.ts";

export class DefaultsNativeFixture {
  root = mkdtempSync(join(tmpdir(), "luna defaults native "));
  home = join(this.root, "home");
  repository = join(this.root, "repository");
  bin = join(this.root, "bin");
  data = join(this.root, "data");
  systemData = join(this.root, "system-data");
  config = join(this.root, "config");
  env: Record<string, string> = {
    HOME: this.home,
    PATH: this.bin,
    XDG_DATA_HOME: this.data,
    XDG_DATA_DIRS: this.systemData,
    XDG_CONFIG_HOME: this.config,
    XDG_CURRENT_DESKTOP: "Hyprland:GNOME",
  };

  constructor() {
    for (const directory of [this.home, this.repository, this.bin])
      mkdirSync(directory, { recursive: true });
  }

  context() {
    return new InstallContext(this.repository, this.home, { ...this.env }, () => {});
  }

  write(path: string, contents: string, executable = false) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, { mode: executable ? 0o755 : 0o644 });
  }

  command(name: string, script = "exit 0") {
    this.write(join(this.bin, name), `#!${Bun.which("sh")}\n${script}\n`, true);
  }

  entry(id: string, fields = "", root = this.data) {
    const path = join(root, "applications", id);
    this.write(path, `[Desktop Entry]\nType=Application\nName=Viewer\nExec=viewer %f\n${fields}`);
    return path;
  }

  read(path: string) {
    return readFileSync(path, "utf8");
  }

  dispose() {
    rmSync(this.root, { recursive: true, force: true });
  }
}
