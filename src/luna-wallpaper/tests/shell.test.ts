import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { quickshell } from "./harness.ts";
import { WallpaperFixture, type SurfaceState } from "./shell-fixture.ts";
import type { WallpaperSettings } from "../../../packages/luna-api/src/index.ts";

setDefaultTimeout(20000);
describe.skipIf(!quickshell || !Bun.which("ffprobe"))("wallpaper shell", () => {
  let f: WallpaperFixture;
  beforeEach(() => {
    f = new WallpaperFixture();
  });
  afterEach(async () => {
    await f?.dispose();
  });
  const dark = (state: SurfaceState) => {
    expect(state.visible).toBe(true);
    expect(state.color).toBe("#000000");
    expect(state.images).toEqual([]);
    expect(state.videos).toEqual([]);
  };

  test("all displays share settings and keep their image when presentation changes", async () => {
    f.twoDisplays();
    f.writeConfig();
    await f.start();
    await f.ready();
    const first = await f.displays();
    expect(first.map((item) => item.screen).sort()).toEqual(["external", "laptop"]);
    expect(first.every((item) => item.images.length === 1)).toBe(true);
    expect(first[0]!.images[0]!.source).toBe(first[1]!.images[0]!.source);
    const ids = first.map((item) => item.images[0]!.id);
    expect(ids[0]).not.toBe(ids[1]);
    f.writeConfig({ fit: "center" });
    expect(await f.reload()).toBe("ok");
    await f.ready();
    const latest = await f.displays();
    expect(latest.map((item) => item.images[0]!.id)).toEqual(ids);
    for (const item of latest) expect(item.images[0]!.fillMode).toBe(item.fillModes.center!);
  });

  test("disconnecting and reconnecting displays preserves the remaining image", async () => {
    f.twoDisplays();
    f.writeConfig();
    await f.start();
    await f.ready();
    const first = await f.displays();
    expect(first).toHaveLength(2);
    const id = first[0]!.images[0]!.id;
    await f.ipc("outputs", [1]);
    await f.until(async () => (await f.displays()).length === 1);
    expect((await f.surface()).images[0]!.id).toBe(id);
    await f.ipc("outputs", [2]);
    await f.until(async () => (await f.displays()).length === 2 && (await f.status()) === "ready");
    const latest = await f.displays();
    expect(latest[0]!.images[0]!.id).toBe(id);
    expect(latest[0]!.images[0]!.source).toBe(latest[1]!.images[0]!.source);
    await f.ipc("outputs", [0]);
    await f.until(async () => (await f.displays()).length === 0);
    expect(await f.status()).toBe("loading");
    await f.ipc("outputs", [2]);
    await f.until(async () => (await f.displays()).length === 2 && (await f.status()) === "ready");
  });

  test("status waits for every display and reports an error from any display", async () => {
    f.twoDisplays();
    f.writeConfig();
    await f.start();
    await f.ready();
    await f.ipc("mediaStatus", [1, "loading"]);
    expect(await f.status()).toBe("loading");
    await f.ipc("mediaStatus", [0, "loading"]);
    await f.ipc("mediaStatus", [1, "error"]);
    expect(await f.status()).toBe("error");
    await f.ipc("mediaStatus", [1, "ready"]);
    expect(await f.status()).toBe("loading");
    await f.ipc("mediaStatus", [0, "ready"]);
    expect(await f.status()).toBe("ready");
  });

  test.each(["animated", "video"])("%s pauses independently on each display", async (kind) => {
    f.twoDisplays();
    const source = join(f.root, "finite.gif");
    if (kind === "animated") f.gif(source);
    else f.fakeProbe();
    f.writeConfig({ source: kind === "animated" ? source : f.image });
    await f.start();
    await f.ready();
    const media = (state: SurfaceState) => (kind === "animated" ? state.images : state.videos);
    await f.ipc("outputActive", [false]);
    await f.until(async () => media((await f.displays())[0]!)[0]!.paused);
    expect(media((await f.displays())[1]!)[0]!.paused).toBe(false);
    await f.ipc("outputActive", [true]);
    await f.until(async () => !media((await f.displays())[0]!)[0]!.paused);
    if (kind === "video") {
      const replacement = join(f.root, "second.mp4");
      f.writeConfig({ source: replacement });
      expect(await f.reload()).toBe("ok");
      await f.ready();
      await f.ipc("outputs", [1]);
      await f.until(async () => (await f.displays()).length === 1);
      await f.ipc("outputs", [2]);
      await f.until(
        async () => (await f.displays()).length === 2 && (await f.status()) === "ready",
      );
      for (const item of await f.displays()) expect(item.videos[0]!.source).toBe(replacement);
    }
  });

  test("public status reports settings and media failures", async () => {
    f.writeConfig();
    expect((await f.start()).status).toBe("ready");
    expect(await f.status()).toBe("ready");
    const invalid = await f.start({ snapshot: "invalid JSON" });
    expect(invalid.settingsStatus).toBe("error");
    expect(invalid.settings).toBeNull();
    dark(invalid);
    expect(await f.status()).toBe("error");
    f.writeConfig({ source: join(f.root, "missing-image.png") });
    expect((await f.start()).status).toBe("error");
    expect(await f.status()).toBe("error");
  });

  test("API snapshots preserve sparse unknown settings, authored formatting, and literal paths", async () => {
    f.writeConfig({ playback: { pause_when_output_inactive: true } });
    const document = Bun.JSONC.parse(readFileSync(f.config, "utf8")) as WallpaperSettings;
    document.future = { values: [1, 2] };
    const original = "// Keep the author's formatting\n" + JSON.stringify(document, null, 4) + "\n";
    f.write(f.config, original);
    const state = await f.start();
    expect(state.settingsStatus).toBe("ready");
    expect(state.status).toBe("ready");
    expect(state.settings).toEqual(document);
    expect(state.kind).toBe("image");
    expect(state.images).toHaveLength(1);
    expect([state.images[0]!.width, state.images[0]!.height]).toEqual([1600, 900]);
    expect(state.images[0]!.source).toContain("%23%3F.png");
    expect(state.videos).toEqual([]);
    expect(readFileSync(f.config, "utf8")).toBe(original);
  });

  test("the renderer uses its snapshot after the source config is removed", async () => {
    f.writeConfig();
    const snapshot = await f.snapshot();
    rmSync(f.config);
    const cwd = join(f.root, "unrelated working directory");
    mkdirSync(cwd);
    const state = await f.start({ cwd, snapshot });
    expect(state.status).toBe("ready");
    expect(state.settings?.wallpaper?.source).toBe(f.image);
    expect(existsSync(f.config)).toBe(false);
  });

  test("disabled watching leaves direct edits unapplied", async () => {
    f.enableWatcher();
    f.writeConfig({ watchConfig: false });
    const first = await f.start();
    f.writeConfig({ source: "" });
    await Bun.sleep(300);
    const latest = await f.surface();
    expect(latest.settings).toEqual(first.settings);
    expect(JSON.parse(await f.ipc("snapshot", [], "wallpaper"))).toEqual(first.settings);
    expect(latest.status).toBe(first.status);
    expect(latest.images[0]!.id).toBe(first.images[0]!.id);
  });

  test("watching applies valid edits and repeated atomic saves without replacing the shell", async () => {
    f.enableWatcher();
    f.writeConfig();
    const first = await f.start();
    const pid = f.process!.pid;
    f.writeConfig({ fit: "center" });
    await f.until(async () => (await f.surface()).settings?.wallpaper?.fit === "center");
    expect((await f.surface()).images[0]!.id).toBe(first.images[0]!.id);
    for (const fit of ["stretch", "tile"]) {
      const staged = f.config + ".new";
      f.write(staged, JSON.stringify({ wallpaper: { source: f.image, fit } }));
      renameSync(staged, f.config);
      await f.until(async () => (await f.surface()).settings?.wallpaper?.fit === fit);
    }
    const source = join(f.root, "watched.png");
    f.png(source);
    f.writeConfig({ source });
    await f.until(async () => (await f.surface()).images[0]?.source.endsWith("watched.png"));
    expect(f.process!.pid).toBe(pid);
    expect(await f.status()).toBe("ready");
  });

  test("invalid watched edits preserve the last valid snapshot and recover on the next save", async () => {
    f.enableWatcher();
    f.writeConfig();
    const first = await f.start();
    f.writeConfig({ fit: "center" });
    await f.until(async () => (await f.surface()).settings?.wallpaper?.fit === "center");
    const valid = (await f.surface()).settings;
    for (const invalid of ['{"wallpaper":', '{"wallpaper":{"fit":"invalid"}}']) {
      f.write(f.config, invalid);
      await Bun.sleep(250);
      expect((await f.surface()).settings).toEqual(valid);
      expect((await f.surface()).images[0]!.id).toBe(first.images[0]!.id);
      expect(await f.status()).toBe("ready");
    }
    f.writeConfig({ fit: "stretch" });
    await f.until(async () => (await f.surface()).settings?.wallpaper?.fit === "stretch");
  });

  test("watching follows atomic target edits and retargeted config symlinks", async () => {
    f.enableWatcher();
    f.writeConfig();
    const personal = join(f.root, "personal");
    mkdirSync(personal);
    const target = join(personal, "wallpaper.jsonc");
    renameSync(f.config, target);
    symlinkSync(target, f.config);
    await f.start();
    const replace = (path: string, fit: string) => {
      f.write(path + ".new", JSON.stringify({ wallpaper: { source: f.image, fit } }));
      renameSync(path + ".new", path);
    };
    replace(target, "center");
    await f.until(async () => (await f.surface()).settings?.wallpaper?.fit === "center");
    const other = join(f.root, "other");
    mkdirSync(other);
    const next = join(other, "wallpaper.jsonc");
    f.write(next, '{"wallpaper":');
    rmSync(f.config);
    symlinkSync(next, f.config);
    await Bun.sleep(250);
    replace(next, "stretch");
    await f.until(async () => (await f.surface()).settings?.wallpaper?.fit === "stretch");
    expect(await f.status()).toBe("ready");
  });

  test("watching can be enabled and disabled without replacing media", async () => {
    f.enableWatcher();
    f.writeConfig({ watchConfig: false });
    const first = await f.start();
    f.writeConfig({ fit: "center", watchConfig: true });
    expect(await f.reload()).toBe("ok");
    f.writeConfig({ fit: "stretch", watchConfig: false });
    await f.until(
      async () =>
        (await f.surface()).settings?.watch_config === false &&
        (await f.surface()).settings?.wallpaper?.fit === "stretch",
    );
    f.writeConfig({ fit: "tile" });
    await Bun.sleep(300);
    expect((await f.surface()).settings?.wallpaper?.fit).toBe("stretch");
    expect((await f.surface()).images[0]!.id).toBe(first.images[0]!.id);
  });

  test("explicitly disabling watching ignores buffered output from the stopped helper", async () => {
    f.writeConfig();
    const snapshot = await f.snapshot();
    const helper = join(f.root, "late-watcher.ts");
    const ready = join(f.root, "watcher-ready");
    f.write(
      helper,
      `import { writeFileSync } from "node:fs";\nprocess.stdout.write(${JSON.stringify(snapshot + "\n")});\nwriteFileSync(${JSON.stringify(ready)}, "");\nsetInterval(() => {}, 1000);\nprocess.on("SIGTERM", () => { process.stdout.write(${JSON.stringify(snapshot + "\n")}); setTimeout(() => process.exit(), 50); });\n`,
    );
    f.env.LUNA_WALLPAPER_WATCH_COMMAND = JSON.stringify([process.execPath, helper]);
    await f.start();
    await f.until(() => existsSync(ready));
    f.writeConfig({ fit: "center", watchConfig: false });
    expect(await f.reload()).toBe("ok");
    await Bun.sleep(250);
    expect((await f.surface()).settings?.watch_config).toBe(false);
    expect((await f.surface()).settings?.wallpaper?.fit).toBe("center");
  });

  test("explicit reload updates presentation without replacing the shell or media", async () => {
    f.writeConfig();
    const first = await f.start();
    const pid = f.process!.pid;
    f.writeConfig({ fit: "center", playback: { pause_when_output_inactive: false } });
    const original = readFileSync(f.config, "utf8");
    expect(await f.reload()).toBe("ok");
    await f.ready();
    const latest = await f.surface();
    expect(f.process!.pid).toBe(pid);
    expect(latest.images[0]!.id).toBe(first.images[0]!.id);
    expect(latest.images[0]!.fillMode).toBe(latest.fillModes.center!);
    expect(latest.settings?.playback?.pause_when_output_inactive).toBe(false);
    expect(readFileSync(f.config, "utf8")).toBe(original);
  });

  test("malformed reload keeps the previous settings and media", async () => {
    f.writeConfig();
    const first = await f.start();
    expect(await f.reload("invalid JSON")).toStartWith("error: ");
    const latest = await f.surface();
    expect(latest.settings).toEqual(first.settings);
    expect(latest.images[0]!.id).toBe(first.images[0]!.id);
    expect(await f.status()).toBe("ready");
  });

  test("a replacement keeps the current image until decoded, then appears at full opacity", async () => {
    const replacement = join(f.root, "replacement.png");
    f.png(replacement);
    f.fakeProbe("hold");
    f.writeConfig();
    const first = await f.start();
    f.writeConfig({ source: replacement });
    expect(await f.reload()).toBe("ok");
    await f.until(() => existsSync(replacement + ".waiting"));
    const pending = await f.surface();
    expect(pending.status).toBe("loading");
    expect(pending.visible).toBe(true);
    expect(pending.images[0]!.id).toBe(first.images[0]!.id);
    expect(pending.images[0]!.source).toBe(first.images[0]!.source);
    expect(pending.images[0]!.opacity).toBe(1);
    f.write(replacement + ".release", "");
    await f.ready();
    const latest = await f.surface();
    expect(latest.images).toHaveLength(1);
    expect(latest.images[0]!.source).toContain("replacement.png");
    expect(latest.images[0]!.id).not.toBe(first.images[0]!.id);
    expect(latest.images[0]!.opacity).toBe(1);
  });

  test("a failed replacement preserves the current image and can recover", async () => {
    f.writeConfig();
    const first = await f.start();
    f.writeConfig({ source: join(f.root, "missing.png") });
    expect(await f.reload()).toBe("ok");
    await f.until(async () => (await f.status()) === "error");
    const failed = await f.surface();
    expect(failed.visible).toBe(true);
    expect(failed.images[0]!.id).toBe(first.images[0]!.id);
    f.writeConfig();
    expect(await f.reload()).toBe("ok");
    expect(await f.status()).toBe("ready");
    expect((await f.surface()).images[0]!.id).toBe(first.images[0]!.id);
  });

  test("reload switches images and video without replacing the shell, including failure recovery", async () => {
    f.fakeProbe("extension");
    f.writeConfig();
    await f.start();
    const pid = f.process!.pid;
    for (const name of ["first.mp4", "second.mp4"]) {
      const source = join(f.root, name);
      f.writeConfig({ source });
      expect(await f.reload()).toBe("ok");
      await f.ready();
      const state = await f.surface();
      expect(state.videos).toEqual([{ source, paused: false }]);
      expect(state.images).toEqual([]);
      expect(f.process!.pid).toBe(pid);
    }
    f.writeConfig();
    expect(await f.reload()).toBe("ok");
    await f.ready();
    const state = await f.surface();
    expect(state.images).toHaveLength(1);
    expect(state.videos).toEqual([]);
    expect(f.process!.pid).toBe(pid);
    const id = state.images[0]!.id;
    f.writeConfig({ source: join(f.root, "broken-video.mp4") });
    expect(await f.reload()).toBe("ok");
    await f.until(async () => (await f.status()) === "error");
    expect((await f.surface()).images[0]!.id).toBe(id);
    f.writeConfig();
    expect(await f.reload()).toBe("ok");
    expect(await f.status()).toBe("ready");
    const recovered = await f.surface();
    expect(recovered.kind).toBe("image");
    expect(recovered.images[0]!.id).toBe(id);
    expect(recovered.videos).toEqual([]);
  });

  test("missing config is created by the API and uses renderer defaults", async () => {
    rmSync(join(f.config, ".."), { recursive: true });
    const state = await f.start();
    expect(state.settingsStatus).toBe("ready");
    expect(state.status).toBe("ready");
    expect(JSON.parse(readFileSync(f.config, "utf8"))).toEqual({});
    expect(state.settings).toEqual({});
    dark(state);
  });

  test("the example config renders its configured background", async () => {
    f.write(
      f.config,
      readFileSync(f.config, "utf8").replace(
        '"background_color": "#000000"',
        '"background_color": "#102030"',
      ),
    );
    const state = await f.start();
    expect(state.status).toBe("ready");
    expect(state.color).toBe("#102030");
    expect(state.images).toEqual([]);
    expect(state.videos).toEqual([]);
  });

  test("old transition fields remain source data and do not animate the wallpaper", async () => {
    const settings = {
      wallpaper: { source: f.image },
      transition: { type: "fade", duration_ms: 2000 },
    };
    const original = JSON.stringify(settings);
    f.write(f.config, original);
    const state = await f.start();
    expect(state.status).toBe("ready");
    expect(state.images[0]!.opacity).toBe(1);
    expect(state.settings).toEqual(settings);
    expect(readFileSync(f.config, "utf8")).toBe(original);
  });

  test.each([
    ["still.gif", "image"],
    ["animation.png", "animated"],
  ])("content detection ignores the extension of %s", async (name, kind) => {
    const source = join(f.root, name!);
    if (kind === "image") f.png(source);
    else f.gif(source);
    f.writeConfig({ source });
    const state = await f.start();
    expect(state.status).toBe("ready");
    expect(state.kind).toBe(kind);
    expect(state.images).toHaveLength(1);
    expect(state.images[0]!.frameCount).toBe(kind === "animated" ? 2 : 1);
  });

  test("finite animations loop and pause with output activity", async () => {
    const source = join(f.root, "finite.gif");
    f.gif(source);
    f.writeConfig({ source });
    await f.start();
    await Bun.sleep(300);
    expect((await f.surface()).images[0]!.playing).toBe(true);
    await f.ipc("outputActive", [false]);
    await f.until(async () => (await f.surface()).images[0]!.paused);
    const frame = (await f.surface()).images[0]!.frame;
    await Bun.sleep(150);
    expect((await f.surface()).images[0]!.frame).toBe(frame);
    await f.ipc("outputActive", [true]);
    await f.until(async () => !(await f.surface()).images[0]!.paused);
  });

  test("animations can keep playing on inactive outputs", async () => {
    const source = join(f.root, "finite.gif");
    f.gif(source);
    f.writeConfig({ source, playback: { pause_when_output_inactive: false } });
    await f.start();
    await f.ipc("outputActive", [false]);
    await Bun.sleep(300);
    const image = (await f.surface()).images[0]!;
    expect(image.paused).toBe(false);
    expect(image.playing).toBe(true);
  });

  test("video metadata selects the video backend", async () => {
    f.fakeProbe();
    f.writeConfig();
    const state = await f.start();
    expect(state.kind).toBe("video");
    expect(state.images).toEqual([]);
    expect(state.videos).toEqual([{ source: f.image, paused: false }]);
  });

  test("fullscreen pauses only on the visible monitor and workspace", async () => {
    f.fakeProbe();
    f.writeConfig({ playback: { pause_when_output_inactive: false } });
    await f.start();
    const monitor = {
      id: 1,
      lastIpcObject: {
        activeWorkspace: { id: 3 },
        dpmsStatus: true,
        specialWorkspace: { id: -99 },
      },
    };
    for (const [output, workspace, mode, hidden, paused] of [
      [1, 3, 2, false, true],
      [2, 3, 2, false, false],
      [1, 4, 2, false, false],
      [1, 3, 1, false, false],
      [1, 3, 0, false, false],
      [1, 3, 2, true, false],
      [1, -99, 2, false, true],
      [1, 3, 0, false, false],
    ] as const) {
      await f.ipc("fullscreen", [
        JSON.stringify({
          monitor,
          windows: [
            {
              lastIpcObject: {
                monitor: output,
                workspace: { id: workspace },
                fullscreen: mode,
                mapped: true,
                hidden,
              },
            },
          ],
        }),
      ]);
      await f.until(async () => (await f.surface()).videos[0]!.paused === paused);
      expect((await f.surface()).videos[0]!.source).toBe(f.image);
    }
    await f.ipc("fullscreen", [JSON.stringify({ monitor, windows: [] })]);
    expect((await f.surface()).videos[0]!.paused).toBe(false);
  });

  test("missing ffprobe falls back to Qt image decoding", async () => {
    f.env.PATH = f.bin;
    f.writeConfig();
    const state = await f.start();
    expect(state.status).toBe("ready");
    expect(state.kind).toBe("image");
    expect(state.images).toHaveLength(1);
  });

  test("corrupt media and late decoding errors clear renderers", async () => {
    f.writeConfig();
    await f.start();
    await f.ipc("decodeError");
    await f.until(async () => (await f.surface()).status === "error");
    dark(await f.surface());
    await f.stop();
    writeFileSync(f.image, "not an image");
    const state = await f.start();
    expect(state.settingsStatus).toBe("ready");
    expect(state.status).toBe("error");
    dark(state);
  });

  test.each(["center", "tile"])("%s preserves native pixels on HiDPI displays", async (fit) => {
    f.env.QT_SCALE_FACTOR = "2";
    f.writeConfig({ fit });
    const state = await f.start();
    const image = state.images[0]!;
    expect(state.dpr).toBe(2);
    expect(image.scale * state.dpr).toBe(1);
    expect(image.displayWidth * image.scale).toBe(state.width);
    expect(image.displayHeight * image.scale).toBe(state.height);
    expect([image.width, image.height]).toEqual([1600, 900]);
  });

  test.each(["fill", "fit", "stretch", "center", "tile"])(
    "%s changes image presentation without downsampling",
    async (fit) => {
      f.writeConfig({ fit });
      const state = await f.start();
      const image = state.images[0]!;
      expect(image.fillMode).toBe(state.fillModes[fit]!);
      expect(image.smooth).toBe(!["center", "tile"].includes(fit));
      expect(image.autoTransform).toBe(true);
      expect([image.width, image.height]).toEqual([1600, 900]);
      expect(image.opacity).toBe(1);
    },
  );
});
