import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { Luna, type WallpaperSettings } from "../../../packages/luna-api/src/index.ts";
import { app, fixtures, ShellHarness } from "./harness.ts";

export interface ImageState {
  id: number;
  source: string;
  status: number;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  scale: number;
  opacity: number;
  fillMode: number;
  smooth: boolean;
  autoTransform: boolean;
  frameCount: number;
  playing: boolean;
  paused: boolean;
  frame: number;
}
export interface SurfaceState {
  settings: WallpaperSettings | null;
  settingsStatus: string;
  status: string;
  fading: boolean;
  kind: string;
  screen: string;
  images: ImageState[];
  videos: { source: string; paused: boolean }[];
  visible: boolean;
  fillModes: Record<string, number>;
  color: string;
  width: number;
  height: number;
  dpr: number;
}

/** Uses the real API loader and renderer, replacing only offscreen placement and video decoding. */
export class WallpaperFixture extends ShellHarness {
  readonly config = join(this.env.XDG_CONFIG_HOME!, "luna/wallpaper.jsonc");
  readonly image = join(this.root, "wallpaper ' #?.png");

  constructor() {
    super();
    cpSync(join(app, "src/shell"), this.renderer, { recursive: true });
    this.write(this.config, readFileSync(join(app, "config.example.jsonc"), "utf8"));
    const shell = readFileSync(join(this.renderer, "shell.qml"), "utf8");
    this.write(
      join(this.renderer, "shell.qml"),
      shell.trimEnd().slice(0, -1) +
        readFileSync(join(fixtures, "shell-inspector.qml"), "utf8") +
        "}\n",
    );
    const surface = readFileSync(join(this.renderer, "WallpaperSurface.qml"), "utf8")
      .replace("PanelWindow {", "FloatingWindow {\n    implicitWidth: 800\n    implicitHeight: 600")
      .replace(/^    anchors \{.*?^    \}/ms, "")
      .replace(/^.*(?:exclusionMode:|WlrLayershell\.).*\n/gm, "")
      .replace(/readonly property var monitor:.*/, "property var monitor: null")
      .replace("Hyprland.toplevels.values", "surface.testToplevels")
      .replace("id: surface", "id: surface\n    property var testToplevels: []");
    this.write(join(this.renderer, "WallpaperSurface.qml"), surface);
    cpSync(join(fixtures, "fake-video.qml"), join(this.renderer, "VideoWallpaper.qml"));
    this.png(this.image);
  }

  twoDisplays() {
    const config = join(this.root, "offscreen.json");
    this.write(
      config,
      JSON.stringify({
        screens: [
          { name: "laptop", x: 0, y: 0, width: 800, height: 600 },
          { name: "external", x: 800, y: 0, width: 1280, height: 720 },
        ],
      }),
    );
    this.env.QT_QPA_PLATFORM = `offscreen:configfile=${config}`;
  }

  writeConfig({
    source = this.image,
    fit = "fit",
    playback,
    watchConfig,
  }: {
    source?: string;
    fit?: string;
    playback?: { pause_when_output_inactive: boolean };
    watchConfig?: boolean;
  } = {}) {
    this.write(
      this.config,
      "// Renderer test settings\n" +
        JSON.stringify({
          wallpaper: { source, fit, background_color: "#102030" },
          ...(playback ? { playback } : {}),
          ...(watchConfig === undefined ? {} : { watch_config: watchConfig }),
        }) +
        "\n",
    );
  }

  enableWatcher() {
    this.env.LUNA_WALLPAPER_WATCH_COMMAND = JSON.stringify([
      process.execPath,
      join(app, "src/watch.ts"),
      this.config,
    ]);
  }

  async snapshot() {
    const result = await Luna.wallpaper.get(undefined, { configFile: this.config, env: this.env });
    if (!result.succes) throw new Error(result.errMessage);
    return JSON.stringify(result.data);
  }

  async start({ cwd, snapshot }: { cwd?: string; snapshot?: string } = {}) {
    this.env.LUNA_WALLPAPER_SETTINGS = snapshot ?? (await this.snapshot());
    await this.launch(cwd);
    await this.until(async () =>
      ["ready", "error"].includes((await this.state<SurfaceState>()).status),
    );
    return this.state<SurfaceState>();
  }

  async surface() {
    return this.state<SurfaceState>();
  }
  async displays(): Promise<SurfaceState[]> {
    return JSON.parse(await this.ipc("displays"));
  }
  status() {
    return this.ipc("status", [], "wallpaper");
  }
  async reload(snapshot?: string) {
    return this.ipc("reload", [snapshot ?? (await this.snapshot())], "wallpaper");
  }
  async ready() {
    await this.until(
      async () => (await this.status()) === "ready" && !(await this.surface()).fading,
    );
  }

  fakeProbe(mode: "video" | "extension" | "hold" = "video") {
    this.script(
      "ffprobe",
      `import { existsSync, writeFileSync } from "node:fs";\nconst source = process.argv.at(-1);\n${mode === "hold" ? `if (source.endsWith("replacement.png")) { writeFileSync(source + ".waiting", ""); while (!existsSync(source + ".release")) await Bun.sleep(10); }` : ""}\nconst video = ${mode === "video" ? "true" : mode === "extension" ? 'source.endsWith(".mp4")' : "false"};\nconsole.log(JSON.stringify({streams:[{codec_name:video?"h264":"png"}],format:{format_name:video?"mov,mp4":"png_pipe"}}));\n`,
    );
  }

  png(path: string) {
    const chunk = (kind: string, data: Uint8Array) => {
      const type = Buffer.from(kind);
      const header = Buffer.alloc(4);
      header.writeUInt32BE(data.length);
      const checksum = Buffer.alloc(4);
      checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
      return Buffer.concat([header, type, data, checksum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1600);
    header.writeUInt32BE(900, 4);
    header[8] = 8;
    header[9] = 2;
    const row = Buffer.alloc(1 + 1600 * 3);
    for (let x = 1; x < row.length; x += 3) row[x] = 255;
    writeFileSync(
      path,
      Buffer.concat([
        Buffer.from("89504e470d0a1a0a", "hex"),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(Buffer.concat(Array(900).fill(row)))),
        chunk("IEND", Buffer.alloc(0)),
      ]),
    );
  }

  gif(path: string) {
    const header = Buffer.from("47494638396101000100800000000000ffffff", "hex");
    const frame = (pixel: number) =>
      Buffer.concat([
        Buffer.from("21f90400050000002c0000000001000100000202", "hex"),
        Buffer.from([pixel, 1, 0]),
      ]);
    writeFileSync(path, Buffer.concat([header, frame(0x44), frame(0x4c), Buffer.from([0x3b])]));
  }
}
