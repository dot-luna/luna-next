import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Luna, type ApiResponse } from "../src/index.ts";

let root: string;
let env: Record<string, string>;
const text = '  {"message":"hello $HOME; $(touch nope)"}\n\n';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
function state() {
  return JSON.parse(readFileSync(env.LUNA_TEST_CLIPBOARD_STATE!, "utf8"));
}
function save(value: object) {
  writeFileSync(env.LUNA_TEST_CLIPBOARD_STATE!, JSON.stringify(value));
}
function calls(): { name: string; args: string[]; parent: number; pid: number }[] {
  return existsSync(env.LUNA_TEST_CLIPBOARD_LOG!)
    ? readFileSync(env.LUNA_TEST_CLIPBOARD_LOG!, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}
function data<T>(response: ApiResponse<T>): T {
  if (!response.succes) throw new Error(response.errMessage);
  return response.data;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "luna clipboard ' "));
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(join(root, "runtime"), { mode: 0o700 });
  env = {
    HOME: root,
    PATH: bin,
    XDG_RUNTIME_DIR: join(root, "runtime"),
    LUNA_TEST_CLIPBOARD_STATE: join(root, "state.json"),
    LUNA_TEST_CLIPBOARD_LOG: join(root, "commands.jsonl"),
    LUNA_TEST_CLIPBOARD_COPY: join(root, "copy"),
    LUNA_TEST_CLIPBOARD_KEYS: join(root, "keys"),
    LUNA_TEST_CLIPBOARD_LUA: Bun.which("lua")!,
  };
  const fixture = resolve(import.meta.dir, "fixtures/clipboard-command.ts");
  for (const name of ["cliphist", "wl-copy", "file", "hyprctl", "wl-paste"]) {
    // Each executable passes its own name as data, keeping test paths with quotes literal.
    writeFileSync(
      join(bin, name),
      `#!${process.execPath}\nBun.argv.splice(2, 0, ${JSON.stringify(name)});\nawait import(${JSON.stringify(fixture)});\n`,
      { mode: 0o755 },
    );
  }
  for (const name of ["flock", "bash", "setsid"]) symlinkSync(Bun.which(name)!, join(bin, name));
  save({
    nextId: 3,
    entries: [
      {
        id: "2",
        name: "[[ binary data 10 B png 1x1 ]]",
        data: png.toString("base64"),
        mime: "image/png",
      },
      {
        id: "1",
        name: text.trim(),
        data: Buffer.from(text).toString("base64"),
        mime: "application/json",
      },
    ],
    window: { address: "0xabc", class: "editor" },
    menuFrames: 0,
  });
});

afterEach(() => {
  const supervisors = new Set(
    calls()
      .filter((call) => call.name === "wl-paste")
      .map((call) => call.parent),
  );
  for (const pid of supervisors) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  rmSync(root, { recursive: true, force: true });
});

test("listing and previews preserve text and image bytes without copying", async () => {
  expect(data(await Luna.clipboard.list({ env })).map((entry) => entry.id)).toEqual(["2", "1"]);
  expect(data(await Luna.clipboard.preview("1", { env })).text).toBe(text);
  expect(data(await Luna.clipboard.preview("2", { env })).image).toBe(
    `data:image/png;base64,${png.toString("base64")}`,
  );
  expect(calls().some((call) => call.name === "wl-copy")).toBe(false);
});

test("copy promotes an old entry and advertises JSON snippets as pasteable text", async () => {
  data(await Luna.clipboard.copy("1", { env }));
  expect(readFileSync(env.LUNA_TEST_CLIPBOARD_COPY!, "utf8")).toBe(text);
  expect(calls().find((call) => call.name === "wl-copy")?.args).toEqual([
    "--type",
    "text/plain;charset=utf-8",
  ]);
  expect(state().entries[0].data).toBe(Buffer.from(text).toString("base64"));
  expect(state().entries.some((entry: { id: string }) => entry.id === "1")).toBe(false);
  expect(calls().some((call) => call.name === "hyprctl")).toBe(false);
});

test("image copy retains binary bytes and MIME without waiting for a forked clipboard owner", async () => {
  save({ ...state(), forkOwner: true });
  const started = Date.now();
  data(await Luna.clipboard.copy("2", { env }));
  expect(Date.now() - started).toBeLessThan(1500);
  expect(readFileSync(env.LUNA_TEST_CLIPBOARD_COPY!)).toEqual(png);
  expect(calls().find((call) => call.name === "wl-copy")?.args).toEqual(["--type", "image/png"]);
});

test.each(["editor", "kitty", "org.wezfurlong.wezterm"])(
  "paste into %s waits for menu dismissal and sends down/up with the right modifiers",
  async (appClass) => {
    save({ ...state(), menuFrames: 2, window: { address: "0xabc", class: appClass } });
    expect(data(await Luna.clipboard.paste("1", { env, target: "0xabc" }))).toEqual({
      id: "1",
      target: "0xabc",
    });
    const modifiers = appClass === "editor" ? "CTRL" : "CTRL SHIFT";
    expect(readFileSync(env.LUNA_TEST_CLIPBOARD_KEYS!, "utf8")).toBe(
      `${modifiers}:down\n${modifiers}:up\n`,
    );
    expect(calls().filter((call) => call.args.includes("layers"))).toHaveLength(3);
    expect(calls().findIndex((call) => call.name === "wl-copy")).toBeLessThan(
      calls().findIndex((call) => call.args[0] === "eval"),
    );
  },
);

test("focus changes keep the restored clipboard but never send a paste shortcut", async () => {
  save({ ...state(), window: { address: "0xdef", class: "editor" } });
  expect(await Luna.clipboard.paste("1", { env, target: "0xabc" })).toMatchObject({
    succes: false,
    err: "CONFLICT",
  });
  expect(readFileSync(env.LUNA_TEST_CLIPBOARD_COPY!, "utf8")).toBe(text);
  expect(calls().some((call) => call.args[0] === "eval")).toBe(false);
});

test("the compositor guard catches a focus race after the API's last query", async () => {
  save({ ...state(), evalAddress: "0xdef" });
  expect(await Luna.clipboard.paste("1", { env, target: "0xabc" })).toMatchObject({
    succes: false,
  });
  expect(existsSync(env.LUNA_TEST_CLIPBOARD_KEYS!)).toBe(false);
});

test("a menu that stays open prevents key injection and leaves the entry copied", async () => {
  save({ ...state(), menuFrames: 10000 });
  expect(await Luna.clipboard.paste("1", { env, target: "0xabc" })).toMatchObject({
    succes: false,
    err: "CONFLICT",
  });
  expect(readFileSync(env.LUNA_TEST_CLIPBOARD_COPY!, "utf8")).toBe(text);
  expect(calls().some((call) => call.args[0] === "eval")).toBe(false);
});

test("database errors are reported instead of showing an empty history", async () => {
  save({ ...state(), fail: "cliphist:list" });
  expect(await Luna.clipboard.list({ env })).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
});

test("native dispatcher failures cannot report a successful paste", async () => {
  save({ ...state(), dispatchFailure: true });
  expect(await Luna.clipboard.paste("1", { env })).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
});

test("invalid IDs/targets, missing entries and failed copies cannot send keys or delete history", async () => {
  expect(await Luna.clipboard.copy("1;touch nope", { env })).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(await Luna.clipboard.paste("1", { env, target: '0xabc"; bad()' })).toMatchObject({
    succes: false,
  });
  expect(calls()).toHaveLength(0);
  expect(await Luna.clipboard.copy("999", { env })).toMatchObject({ succes: false });
  save({ ...state(), fail: "wl-copy:--type" });
  expect(await Luna.clipboard.paste("1", { env })).toMatchObject({ succes: false });
  expect(state().entries).toHaveLength(2);
  expect(calls().some((call) => call.args[0] === "eval")).toBe(false);
});

test("delete and clear affect saved history only, and an empty database lists cleanly", async () => {
  writeFileSync(env.LUNA_TEST_CLIPBOARD_COPY!, "keep");
  data(await Luna.clipboard.delete("1", { env }));
  expect(data(await Luna.clipboard.list({ env })).map((entry) => entry.id)).toEqual(["2"]);
  data(await Luna.clipboard.clear({ env }));
  expect(data(await Luna.clipboard.list({ env }))).toEqual([]);
  expect(readFileSync(env.LUNA_TEST_CLIPBOARD_COPY!, "utf8")).toBe("keep");
});

test("starting history twice owns only one text/image watcher pair", async () => {
  expect(data(await Luna.clipboard.start({ env }))).toEqual({ running: true });
  expect(data(await Luna.clipboard.start({ env }))).toEqual({ running: true });
  const deadline = Date.now() + 2000;
  while (calls().filter((call) => call.name === "wl-paste").length < 2 && Date.now() < deadline)
    await Bun.sleep(10);
  const watchers = calls().filter((call) => call.name === "wl-paste");
  expect(watchers).toHaveLength(2);
  expect(watchers.map((call) => call.args[1]).sort()).toEqual(["image", "text"]);
  expect(watchers.every((call) => call.args[2] === "--watch" && call.args.at(-1) === "store")).toBe(
    true,
  );
});

test("missing tools and linked runtime paths fail without starting a watcher", async () => {
  expect(await Luna.clipboard.list({ env: { ...env, PATH: "" } })).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  symlinkSync(root, join(root, "runtime/luna-clipboard"));
  expect(await Luna.clipboard.start({ env })).toMatchObject({ succes: false, err: "INVALID_PATH" });
  expect(calls()).toHaveLength(0);
});

test("emoji search is offline and includes named, toned and joined sequences", async () => {
  const entries = data(await Luna.emoji.list());
  expect(entries).toHaveLength(3944);
  expect(new Set(entries.map((entry) => entry.emoji)).size).toBe(entries.length);
  expect(data(await Luna.emoji.list("RED heart")).some((entry) => entry.emoji === "❤️")).toBe(true);
  expect(data(await Luna.emoji.list("👍🏽"))[0]?.emoji).toBe("👍🏽");
  expect(entries.some((entry) => entry.emoji === "👨‍👩‍👧‍👦")).toBe(true);
  expect(data(await Luna.emoji.list("no-such-emoji"))).toEqual([]);
  entries[0]!.name = "changed";
  expect(data(await Luna.emoji.list())[0]!.name).not.toBe("changed");
  expect(calls()).toHaveLength(0);
});

test("emoji copy preserves selection order, repeats and Unicode without pasting", async () => {
  const values = ["❤️", "👍🏽", "👨‍👩‍👧‍👦", "❤️"];
  expect(data(await Luna.emoji.copy(values, { env }))).toEqual({ text: values.join("") });
  expect(readFileSync(env.LUNA_TEST_CLIPBOARD_COPY!, "utf8")).toBe(values.join(""));
  expect(Buffer.from(state().entries[0].data, "base64").toString()).toBe(values.join(""));
  expect(calls().some((call) => call.name === "hyprctl")).toBe(false);
});

test("emoji insertion uses the same dismissal and focus checks as clipboard history", async () => {
  save({ ...state(), menuFrames: 1 });
  expect(data(await Luna.emoji.paste(["😀"], { env, target: "0xabc" }))).toEqual({
    text: "😀",
    target: "0xabc",
  });
  expect(readFileSync(env.LUNA_TEST_CLIPBOARD_KEYS!, "utf8")).toBe("CTRL:down\nCTRL:up\n");
  rmSync(env.LUNA_TEST_CLIPBOARD_KEYS!);
  save({ ...state(), window: { address: "0xdef", class: "editor" } });
  expect(await Luna.emoji.paste(["❤️"], { env, target: "0xabc" })).toMatchObject({
    succes: false,
    err: "CONFLICT",
  });
  expect(readFileSync(env.LUNA_TEST_CLIPBOARD_COPY!, "utf8")).toBe("❤️");
  expect(existsSync(env.LUNA_TEST_CLIPBOARD_KEYS!)).toBe(false);
});

test("invalid emoji selections and targets cannot change the clipboard", async () => {
  for (const values of [[], ["plain text"], ["😀", "bad"], Array(257).fill("😀")])
    expect(await Luna.emoji.copy(values, { env })).toMatchObject({
      succes: false,
      err: "INVALID_ARGUMENT",
    });
  expect(await Luna.emoji.paste(["😀"], { env, target: "invalid" })).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(calls()).toHaveLength(0);
});

test("history labels hide binary markers and visible previews identify attachments", async () => {
  const current = state();
  current.entries.push({
    id: "3",
    name: "[[ binary data 12 B ]]",
    data: Buffer.from("%PDF-fixture").toString("base64"),
    mime: "application/pdf",
  });
  current.entries.push({
    id: "4",
    name: "file:///home/example/Quarterly%20report.pdf",
    data: Buffer.from("file:///home/example/Quarterly%20report.pdf").toString("base64"),
    mime: "text/uri-list",
  });
  save(current);
  const entries = data(await Luna.clipboard.list({ env }));
  expect(entries[0]).toMatchObject({ id: "2", name: "[PNG] 10 B png 1x1", attachment: true });
  expect(entries[2]).toMatchObject({ id: "3", name: "[File] 12 B", attachment: true });
  expect(entries[3]?.name).toBe("[PDF] Quarterly report.pdf");
  expect(calls().filter((call) => call.args[0] === "decode")).toHaveLength(0);
  expect(data(await Luna.clipboard.preview("3", { env })).text).toBe("[PDF] 12 bytes");
  expect(data(await Luna.clipboard.preview("4", { env })).text).toBe("[PDF] Quarterly report.pdf");
  expect(calls().some((call) => call.name === "wl-copy")).toBe(false);
});

test("valid UTF-8 source previews remain readable for nonstandard text MIME types", async () => {
  save({
    ...state(),
    entries: [
      {
        id: "1",
        name: "select 1;",
        data: Buffer.from("select 1;").toString("base64"),
        mime: "application/sql",
      },
    ],
  });
  expect(data(await Luna.clipboard.preview("1", { env })).text).toBe("select 1;");
});

const realCliphist = Bun.which("cliphist");
test.skipIf(!realCliphist)(
  "real cliphist flattened and truncated file lists resolve full filenames",
  async () => {
    const paths = [
      "copy\nfile:///tmp/first%20long%20filename.png\nfile:///tmp/second.pdf",
      "file:///tmp/photo.png\nfile:///tmp/archive.zip",
    ];
    for (const [index, value] of paths.entries()) {
      const args = [
        realCliphist!,
        "-db-path",
        join(root, `real-${index}.db`),
        "-preview-width",
        "30",
      ];
      const isolated = { HOME: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root };
      const stored = Bun.spawnSync([...args, "store"], {
        env: isolated,
        stdin: Buffer.from(value),
      });
      expect(stored.exitCode, stored.stderr.toString()).toBe(0);
      const listed = Bun.spawnSync([...args, "list"], { env: isolated });
      expect(listed.exitCode, listed.stderr.toString()).toBe(0);
      const summary = listed.stdout.toString().trim().split("\t").slice(1).join("\t");
      expect(summary).not.toContain("\n");
      expect(summary.length).toBeLessThan(value.length);
      save({
        ...state(),
        entries: [
          {
            id: "1",
            name: summary,
            data: Buffer.from(value).toString("base64"),
            mime: "text/plain",
          },
        ],
      });
      expect(data(await Luna.clipboard.list({ env }))[0]?.attachment).toBe(true);
      expect(data(await Luna.clipboard.preview("1", { env })).name).toBe(
        index === 0
          ? "[PNG] first long filename.png · [PDF] second.pdf"
          : "[PNG] photo.png · [ZIP] archive.zip",
      );
    }
  },
);
