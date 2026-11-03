import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { Luna } from "../src/index.ts";
import { WallpaperFixture } from "./fixtures/wallpaper-fixture.ts";

let f: WallpaperFixture;
beforeEach(() => {
  f = new WallpaperFixture();
});
afterEach(() => {
  f.dispose();
});

test("wallpaper reads JSONC once, preserves sources and unknown values, and returns null for missing settings", async () => {
  const source =
    '// personal settings\n{"wallpaper":{"fit":"fit","future":null,},"future":{"enabled":true},}\n';
  f.source(source);
  expect(await Luna.wallpaper.get(undefined, f.options)).toEqual({
    succes: true,
    data: { wallpaper: { fit: "fit", future: null }, future: { enabled: true } },
  });
  expect(await Luna.wallpaper.get("wallpaper.source", f.options)).toEqual({
    succes: true,
    data: null,
  });
  expect(await Luna.wallpaper.get("toString", f.options)).toEqual({ succes: true, data: null });
  expect(await Luna.wallpaper.get("wallpaper..source", f.options)).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(f.read()).toBe(source);
  f.source('{"wallpaper":{"source":"/new.png"}}');
  expect(await Luna.wallpaper.get("wallpaper.source", f.options)).toEqual({
    succes: true,
    data: "/new.png",
  });
  expect(f.commands()).toHaveLength(0);
});

test("missing and empty wallpaper documents use sparse defaults without rewriting existing sources", async () => {
  const file = join(f.root, "nested/settings.jsonc");
  expect(await Luna.wallpaper.get(undefined, { configFile: file, env: {} })).toEqual({
    succes: true,
    data: {},
  });
  expect(readFileSync(file, "utf8")).toBe("{}\n");
  expect(statSync(file).mode & 0o777).toBe(0o600);
  for (const source of ["", " \n\t", "{}"]) {
    f.source(source);
    expect(await Luna.wallpaper.get(undefined, f.options)).toEqual({ succes: true, data: {} });
    expect(f.read()).toBe(source);
  }
});

test("path selection honors explicit files, environment overrides, Luna and XDG homes", async () => {
  const cases = [
    [{ env: { HOME: f.root } }, join(f.root, ".config/luna/wallpaper.jsonc")],
    [f.options, f.configFile],
    [
      { env: { ...f.env, LUNA_CONFIG_HOME_DIR: join(f.root, "custom") } },
      join(f.root, "custom/wallpaper.jsonc"),
    ],
    [{ env: { ...f.env, LUNA_WALLPAPER_CONFIG: "relative.jsonc" } }, resolve("relative.jsonc")],
    [
      { configFile: "explicit.json", env: { ...f.env, LUNA_WALLPAPER_CONFIG: "ignored" } },
      resolve("explicit.json"),
    ],
  ] as const;
  for (const [options, path] of cases)
    expect(await Luna.wallpaper.getConfigFile(options)).toEqual({ succes: true, data: path });
  for (const configFile of ["", "/", "/bad\n.jsonc"])
    expect(await Luna.wallpaper.getConfigFile({ configFile, env: {} })).toMatchObject({
      succes: false,
      err: "INVALID_PATH",
    });
  expect(await Luna.wallpaper.getConfigFile({ env: {} })).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
});

test("feature Zod schema rejects invalid known values and HOCON without touching source", async () => {
  const documents: unknown[] = [
    null,
    [],
    1,
    { wallpaper: null },
    { wallpaper: [] },
    { playback: false },
    { transition: "fade" },
    ...[
      "relative.png",
      "~/image.png",
      "file:///image.png",
      "/bad\n.png",
      "/bad\0.png",
      "/bad\x7f.png",
      3,
      null,
    ].map((source) => ({ wallpaper: { source } })),
    ...["unknown", 3, null].map((fit) => ({ wallpaper: { fit } })),
    ...["red", "#12345678", "#123456\n"].map((background_color) => ({
      wallpaper: { background_color },
    })),
    ...["false", null].map((pause_when_output_inactive) => ({
      playback: { pause_when_output_inactive },
    })),
    ...[-1, 0.5, 2147483648, "200", null].map((duration_ms) => ({ transition: { duration_ms } })),
    { transition: { type: "unknown" } },
  ];
  for (const document of documents) {
    const source = JSON.stringify(document);
    f.source(source);
    expect(await Luna.wallpaper.get(undefined, f.options)).toMatchObject({
      succes: false,
      err: "INVALID_METADATA",
    });
    expect(f.read()).toBe(source);
  }
  f.source('wallpaper { fit = "fit" }');
  expect(await Luna.wallpaper.get(undefined, f.options)).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  for (const duration_ms of [0, 2147483647]) {
    f.source(JSON.stringify({ transition: { duration_ms } }));
    expect(await Luna.wallpaper.get("transition.duration_ms", f.options)).toEqual({
      succes: true,
      data: duration_ms,
    });
  }
  expect(f.commands()).toHaveLength(0);
});

test("start snapshots settings once, repeated start preserves the instance, reload updates it and restart replaces it", async () => {
  f.source('{"wallpaper":{"source":"/first.png"}}');
  expect(await Luna.wallpaper.status(f.options)).toMatchObject({
    succes: true,
    data: { running: false, status: "stopped" },
  });
  expect(await Luna.wallpaper.start(f.options)).toMatchObject({
    succes: true,
    data: { running: true, status: "ready", configFile: f.configFile, shellDirectory: f.shell },
  });
  f.source('{"wallpaper":{"source":"/second.png"}}');
  await Luna.wallpaper.start(f.options);
  expect(f.state().settings.wallpaper.source).toBe("/first.png");
  expect(await Luna.wallpaper.reload(f.options)).toMatchObject({
    succes: true,
    data: { status: "ready" },
  });
  expect(f.state().settings.wallpaper.source).toBe("/second.png");
  expect(f.commands().filter((c) => c.args.includes("--daemonize"))).toHaveLength(1);
  expect(f.commands().filter((c) => c.args.includes("kill"))).toHaveLength(0);
  expect(await Luna.wallpaper.restart(f.options)).toMatchObject({
    succes: true,
    data: { status: "ready" },
  });
  expect(f.commands().filter((c) => c.args.includes("--daemonize"))).toHaveLength(2);
  expect(f.commands().filter((c) => c.args.includes("kill"))).toHaveLength(1);
  for (const command of f.commands()) expect(command.args).toContain(f.shell);
  const snapshots = f
    .commands()
    .filter((c) => c.snapshot)
    .map((c) => JSON.parse(c.snapshot!));
  expect(snapshots).toEqual([
    { wallpaper: { source: "/first.png" } },
    { wallpaper: { source: "/second.png" } },
  ]);
  expect(f.env.LUNA_WALLPAPER_SETTINGS).toBeUndefined();
  expect(await Luna.wallpaper.stop(f.options)).toMatchObject({
    succes: true,
    data: { running: false },
  });
  expect(await Luna.wallpaper.stop(f.options)).toMatchObject({
    succes: true,
    data: { running: false },
  });
  expect(await Luna.wallpaper.reload(f.options)).toMatchObject({
    succes: true,
    data: { running: false },
  });
});

test("mutations merge sparse groups, reload without process replacement, and preserve symlink targets and modes", async () => {
  const actual = join(f.root, "personal.jsonc");
  const original = '// settings\n{"wallpaper":{"fit":"fit","future":null},"future":true}\n';
  f.write(actual, original, 0o640);
  symlinkSync(actual, f.configFile);
  await Luna.wallpaper.start(f.options);
  const source = "/pictures/a ' # ? $(`name`).png";
  expect(await Luna.wallpaper.set(source, f.options)).toMatchObject({
    succes: true,
    data: { wallpaper: { source, fit: "fit", future: null }, future: true },
  });
  expect(lstatSync(f.configFile).isSymbolicLink()).toBe(true);
  expect(statSync(actual).mode & 0o777).toBe(0o640);
  expect(JSON.parse(f.read())).toEqual({
    wallpaper: { source, fit: "fit", future: null },
    future: true,
  });
  expect(f.state().settings.wallpaper.source).toBe(source);
  expect(f.commands().filter((c) => c.args.includes("--daemonize"))).toHaveLength(1);
  expect(f.commands().filter((c) => c.args.includes("kill"))).toHaveLength(0);
  expect(
    await Luna.wallpaper.configure({ transition: { duration_ms: 0 } }, f.options),
  ).toMatchObject({
    succes: true,
    data: { wallpaper: { source, fit: "fit" }, transition: { duration_ms: 0 } },
  });
});

test("stopped mutations stay stopped; invalid mutations leave document and renderer untouched", async () => {
  f.source("{}\n");
  expect(await Luna.wallpaper.set("/first.png", f.options)).toMatchObject({ succes: true });
  expect(
    f.commands().some((c) => c.args.includes("--daemonize") || c.args.includes("reload")),
  ).toBe(false);
  const before = f.read();
  const count = f.commands().length;
  expect(await Luna.wallpaper.configure({ wallpaper: { fit: "bad" } }, f.options)).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(f.read()).toBe(before);
  expect(f.commands()).toHaveLength(count);
});

test("failed asynchronous media reload restores the exact source and previous renderer snapshot", async () => {
  const before = '// keep this comment\n{"wallpaper":{"source":"/good.png",},}\n';
  f.source(before);
  await Luna.wallpaper.start(f.options);
  expect(await Luna.wallpaper.set("/broken.png", f.options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  expect(f.read()).toBe(before);
  expect(f.state()).toMatchObject({
    running: true,
    status: "ready",
    settings: { wallpaper: { source: "/good.png" } },
  });
  expect(f.commands().filter((c) => c.args.includes("reload"))).toHaveLength(2);
  expect(f.commands().filter((c) => c.args.includes("kill"))).toHaveLength(0);
});

test("rejected reload restores source, while an external edit prevents obsolete source and renderer recovery", async () => {
  f.source("{}\n");
  await Luna.wallpaper.start(f.options);
  f.env.LUNA_TEST_REJECT = "1";
  expect(await Luna.wallpaper.set("/broken.png", f.options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  expect(f.read()).toBe("{}\n");
  f.env.LUNA_TEST_EXTERNAL = '{"wallpaper":{"source":"/external.png"}}\n';
  const count = f.commands().filter((c) => c.args.includes("reload")).length;
  expect(await Luna.wallpaper.set("/broken.png", f.options)).toMatchObject({
    succes: false,
    err: "CONFLICT",
  });
  expect(f.read()).toBe(f.env.LUNA_TEST_EXTERNAL);
  expect(f.commands().filter((c) => c.args.includes("reload"))).toHaveLength(count + 1);
});

test("invalid restart config is rejected before stopping an existing renderer", async () => {
  await Luna.wallpaper.start(f.options);
  f.source('{"wallpaper":{"fit":"invalid"}}');
  expect(await Luna.wallpaper.restart(f.options)).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  expect(f.state().running).toBe(true);
  expect(f.commands().some((c) => c.args[0] === "kill")).toBe(false);
});

test("a concurrent settings mutation fails without changing source or contacting the renderer", async () => {
  f.source("{}\n");
  const lock = Bun.spawn(
    ["flock", "--exclusive", `${f.configFile}.lock`, "bash", "-c", 'printf "locked\\n"; read -r'],
    { env: f.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  const ready = await lock.stdout.getReader().read();
  expect(new TextDecoder().decode(ready.value)).toBe("locked\n");
  try {
    expect(await Luna.wallpaper.set("/new.png", f.options)).toMatchObject({
      succes: false,
      err: "CONFLICT",
    });
    expect(f.read()).toBe("{}\n");
    expect(f.commands()).toHaveLength(0);
  } finally {
    lock.stdin.write("done\n");
    lock.stdin.end();
    await lock.exited;
  }
});

test("renderer source selection, missing QML and command failures return diagnostics without changing caller env", async () => {
  const repository = join(f.root, "checkout");
  const shell = join(repository, "src/luna-wallpaper/src/shell");
  f.write(join(shell, "shell.qml"), "// fixture");
  expect(await Luna.wallpaper.status({ ...f.options, repository })).toMatchObject({
    succes: true,
    data: { shellDirectory: shell },
  });
  f.env.LUNA_TEST_START_FAIL = "1";
  const failure = await Luna.wallpaper.start(f.options);
  expect(failure).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  if (!failure.succes) expect(failure.errMessage).toContain("startup fixture failure");
  rmSync(join(f.bin, "qs"));
  expect(await Luna.wallpaper.status(f.options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  rmSync(f.shell, { recursive: true });
  expect(await Luna.wallpaper.status(f.options)).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
  expect(existsSync(f.env.LUNA_TEST_STATE!)).toBe(false);
});
