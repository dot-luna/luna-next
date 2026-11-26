import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { quickshell } from "./harness.ts";
import { VideoFixture } from "./video-fixture.ts";

setDefaultTimeout(20000);
describe.skipIf(!quickshell)("wallpaper video controller", () => {
  let f: VideoFixture;
  beforeEach(async () => {
    f = new VideoFixture();
    await f.launch();
  });
  afterEach(async () => {
    await f?.dispose();
  });
  const remove = (name: string) => rmSync(join(f.root, name), { force: true });
  const hasCommand = (command: unknown[]) =>
    f.commands().some((row) => JSON.stringify(row.command) === JSON.stringify(command));

  test("readiness requires decoded video and arguments remain literal", async () => {
    f.mark("hold");
    const source = await f.start();
    await f.until(async () => (await f.video()).connected);
    expect((await f.video()).status).toBe("loading");
    const launch = f.launches()[0]!;
    expect(launch.args.slice(-2)).toEqual(["DP-1", source]);
    expect(launch.args.slice(0, 2)).toEqual(["--layer", "bottom"]);
    const options = launch.args[3]!;
    for (const option of [
      "config=no",
      "load-scripts=no",
      "loop-file=inf",
      "audio=no",
      "hwdec=auto",
    ])
      expect(options).toContain(option);
    expect(options).not.toContain("fps=");
    expect(options).not.toContain("vf=");
    expect(launch.cwd).toBe(launch.home);
    expect(statSync(launch.cwd).mode & 0o777).toBe(0o700);
    remove("hold");
    await f.ready();
    expect(existsSync(join(f.root, "forbidden"))).toBe(false);
  });

  test("pause commands and destruction release the owned player and runtime directory", async () => {
    await f.start();
    await f.ready();
    const directory = (await f.video()).directory;
    const pid = f.launches()[0]!.pid;
    for (const value of [true, false]) {
      await f.ipc("pause", [value]);
      await f.until(() => hasCommand(["set_property", "pause", value]));
    }
    await f.ipc("destroy");
    await f.until(() => !existsSync(directory));
    await f.until(() => !existsSync(`/proc/${pid}`));
    expect((await f.video()).status).toBe("absent");
    expect((await f.video()).error).toBe("");
  });

  test("video switches reuse the player and preserve literal paths", async () => {
    await f.start();
    await f.ready();
    const launch = f.launches()[0]!;
    const source = join(f.root, 'next video;$(touch forbidden)".mp4');
    f.mark("hold-load");
    await f.ipc("load", [source]);
    await f.until(() => hasCommand(["loadfile", source, "replace"]));
    expect((await f.video()).status).toBe("loading");
    expect((await f.video()).error).toBe("");
    remove("hold-load");
    await f.ready();
    expect(f.launches()).toEqual([launch]);
    expect(existsSync(`/proc/${launch.pid}`)).toBe(true);
    expect(existsSync(join(f.root, "forbidden"))).toBe(false);
  });

  test("old notifications and replies cannot complete a replacement", async () => {
    await f.start();
    await f.ready();
    f.mark("defer-parameters");
    f.event({ event: "video-reconfig" });
    const deferred = join(f.root, "deferred-reply");
    await f.until(() => existsSync(deferred));
    remove("defer-parameters");
    f.mark("hold-load");
    await f.ipc("load", [join(f.root, "next.mp4")]);
    await f.until(() => f.commands().some((row) => row.command[0] === "loadfile"));
    const count = f.commands().length;
    f.event(
      [
        readFileSync(deferred, "utf8"),
        JSON.stringify({
          event: "property-change",
          name: "video-out-params",
          data: { w: 3840, h: 2160 },
        }),
        JSON.stringify({ event: "file-loaded" }),
      ].join("\n"),
    );
    await f.until(() => f.commands().length > count);
    expect((await f.video()).status).toBe("loading");
    f.mark("hold");
    remove("hold-load");
    await f.until(() => !existsSync(join(f.root, "event")));
    expect((await f.video()).status).toBe("loading");
    remove("hold");
    await f.ready();
    expect(f.launches()).toHaveLength(1);
  });

  test("presentation changes apply without reloading the same video", async () => {
    const source = await f.start();
    await f.ready();
    const launch = f.launches()[0]!;
    const count = f.commands().length;
    await f.ipc("settings", ["stretch", "#123456"]);
    await f.ipc("pause", [true]);
    const expected = [
      ["set_property", "keepaspect", false],
      ["set_property", "panscan", 0],
      ["set_property", "video-unscaled", "no"],
      ["set_property", "background-color", "#123456"],
      ["set_property", "pause", true],
    ];
    await f.until(() =>
      expected.every((command) =>
        f
          .commands()
          .slice(count)
          .some((row) => JSON.stringify(row.command) === JSON.stringify(command)),
      ),
    );
    await f.ipc("load", [source]);
    expect(f.commands().some((row) => row.command[0] === "loadfile")).toBe(false);
    expect(f.launches()).toEqual([launch]);
    expect((await f.video()).status).toBe("ready");
  });

  test.each(["settings", "load"])(
    "%s command failures report errors and clean up",
    async (command) => {
      await f.start();
      await f.ready();
      const directory = (await f.video()).directory;
      f.mark("command-error");
      if (command === "settings") await f.ipc("settings", ["fit", "#abcdef"]);
      else await f.ipc("load", [join(f.root, "broken.mp4")]);
      await f.until(async () => (await f.video()).status === "error");
      expect((await f.video()).error).toContain("could not update playback");
      await f.until(() => !existsSync(directory));
    },
  );

  test.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "settings acknowledgements are required (switch=%s, failure=%s)",
    async (switchVideo, failure) => {
      await f.start();
      await f.ready();
      f.mark("hold-updates");
      await f.ipc("settings", ["stretch", "#123456"]);
      if (switchVideo) {
        const count = f.commands().length;
        await f.ipc("load", [join(f.root, "next.mp4")]);
        await f.until(() =>
          f
            .commands()
            .slice(count)
            .some(
              (row) =>
                JSON.stringify(row.command) ===
                JSON.stringify(["get_property", "video-out-params"]),
            ),
        );
        await Bun.sleep(100);
      }
      expect((await f.video()).status).toBe("loading");
      if (failure) f.mark("command-error");
      remove("hold-updates");
      await f.until(async () => (await f.video()).status === (failure ? "error" : "ready"));
      if (failure) expect((await f.video()).error).toContain("property unavailable");
    },
  );

  test.each(["timeout", "decode"])("replacement %s releases the player", async (failure) => {
    await f.start();
    await f.ready();
    const directory = (await f.video()).directory;
    f.mark("hold-load");
    await f.ipc("load", [join(f.root, "replacement.mp4")]);
    if (failure === "decode")
      f.event({ event: "end-file", reason: "error", file_error: "decode failed" });
    await f.until(async () => (await f.video()).status === "error");
    expect((await f.video()).error).toContain(failure);
    await f.until(() => !existsSync(directory));
  });

  test("decoder diagnostics allow recovery and retain bounded context", async () => {
    f.mark("hold");
    await f.start();
    await f.until(async () => (await f.video()).connected);
    const diagnostic = async (level: string, text: string) => {
      f.event({ event: "log-message", level, text });
      await f.until(async () => (await f.video()).diagnostic === text.slice(-600).trim());
      expect((await f.video()).error).toBe("");
    };
    await diagnostic("error", "Recoverable hardware decoder error");
    expect((await f.video()).status).toBe("loading");
    remove("hold");
    await f.ready();
    await diagnostic("fatal", "Recoverable decoder context: " + "x".repeat(900));
    expect((await f.video()).status).toBe("ready");
  });

  test("runtime helpers are resolved from PATH", async () => {
    for (const name of ["mktemp", "rm"]) {
      const executable = Bun.which(name)!;
      f.script(
        name,
        `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(join(f.root, "helpers"))}, ${JSON.stringify(name + "\n")});\nconst child = Bun.spawn([${JSON.stringify(executable)}, ...process.argv.slice(2)], {stdin:"inherit",stdout:"inherit",stderr:"inherit"});\nprocess.exit(await child.exited);\n`,
      );
    }
    await f.start();
    await f.ready();
    const directory = (await f.video()).directory;
    await f.ipc("destroy");
    await f.until(() => !existsSync(directory));
    expect(readFileSync(join(f.root, "helpers"), "utf8").trim().split("\n")).toEqual([
      "mktemp",
      "rm",
    ]);
  });

  test.each([
    ["fit", "panscan=0"],
    ["stretch", "keepaspect=no"],
    ["center", "video-unscaled=yes"],
    ["tile", "video-unscaled=yes"],
    ["unknown", "panscan=1"],
  ])("%s selects the expected player sizing", async (fit, expected) => {
    await f.start(fit);
    await f.ready();
    expect(f.launches().at(-1)!.args[3]).toContain(expected!);
  });

  test.each([
    ["hold", "timeout"],
    ["crash", "exited (3)"],
  ])("startup %s reports a failure and cleans up", async (marker, expected) => {
    f.mark(marker!);
    await f.start();
    await f.until(async () => (await f.video()).status === "error");
    expect((await f.video()).error).toContain(expected!);
    await f.until(async () => !(await f.video()).directory);
  });

  test.each(["disconnect", "bad-ipc", "decode", "stop"])(
    "%s after readiness fails and cleans up",
    async (failure) => {
      await f.start();
      await f.ready();
      const directory = (await f.video()).directory;
      if (failure === "disconnect") f.mark("disconnect");
      else if (failure === "bad-ipc") f.event("not json");
      else if (failure === "decode")
        f.event({ event: "end-file", reason: "error", error: "decode failed" });
      else f.event({ event: "end-file", reason: "stop" });
      await f.until(async () => (await f.video()).status === "error");
      expect((await f.video()).error).not.toBe("");
      await f.until(() => !existsSync(directory));
    },
  );
});
