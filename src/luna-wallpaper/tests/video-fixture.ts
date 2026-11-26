import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app, fixtures, ShellHarness } from "./harness.ts";

export interface VideoState {
  status: string;
  error: string;
  directory: string;
  diagnostic: string;
  connected: boolean;
}
export interface Launch {
  args: string[];
  pid: number;
  cwd: string;
  home: string;
}
export interface Command {
  command: (string | number | boolean)[];
  request_id: number;
}

export class VideoFixture extends ShellHarness {
  constructor() {
    super();
    for (const name of ["VideoWallpaper.qml", "Video.js"])
      cpSync(join(app, "src/shell", name), join(this.renderer, name));
    cpSync(join(fixtures, "video-shell.qml"), join(this.renderer, "shell.qml"));
    this.script("mpvpaper", readFileSync(join(fixtures, "fake-mpvpaper.ts"), "utf8"));
    this.env.LUNA_TEST_VIDEO_ROOT = this.root;
  }
  rows<T>(name: string): T[] {
    const path = join(this.root, name);
    return existsSync(path)
      ? readFileSync(path, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  }
  launches() {
    return this.rows<Launch>("launches");
  }
  commands() {
    return this.rows<Command>("commands");
  }
  async video() {
    return this.state<VideoState>();
  }
  async ready() {
    await this.until(async () => (await this.video()).status === "ready");
  }
  async start(fit = "fill") {
    const source = join(this.root, "wallpaper with spaces;$(touch forbidden).mp4");
    await this.ipc("start", [source, fit]);
    return source;
  }
  mark(name: string) {
    this.write(join(this.root, name), "");
  }
  event(value: unknown) {
    this.write(join(this.root, "event"), typeof value === "string" ? value : JSON.stringify(value));
  }
}
