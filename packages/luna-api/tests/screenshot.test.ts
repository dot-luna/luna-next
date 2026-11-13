import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Luna, type ApiResponse } from "../src/index.ts";
import type { ScreenshotMode, ScreenshotResult } from "../src/index.ts";

const roots: string[] = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "luna screenshot ' "));
  roots.push(root);
  const home = join(root, "home");
  const bin = join(root, "bin");
  const directory = join(home, "Pictures/Screenshots");
  mkdirSync(home);
  mkdirSync(bin);
  for (const name of ["bash", "flock"]) symlinkSync(Bun.which(name)!, join(bin, name));
  const env: Record<string, string> = {
    HOME: home,
    PATH: bin,
    XDG_RUNTIME_DIR: join(root, "runtime"),
    LUNA_SCREENSHOT_TEST_ROOT: root,
  };
  const script = `#!${process.execPath}
import {appendFileSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
const root=process.env.LUNA_SCREENSHOT_TEST_ROOT;
const name=Bun.argv[1].split('/').at(-1);
const args=Bun.argv.slice(2);
appendFileSync(root+'/calls',JSON.stringify({name,args})+'\\n');
if(name==='slurp') {
 if(process.env.LUNA_TEST_BLOCK) {writeFileSync(root+'/selecting','');while(!existsSync(root+'/release'))await Bun.sleep(10);}
 process.stdout.write(process.env.LUNA_TEST_REGION??'-50,30 640x480');
 process.stderr.write(process.env.LUNA_TEST_SELECTOR_ERROR??'');
 process.exit(Number(process.env.LUNA_TEST_SELECTOR_CODE??0));
} else if(name==='hyprctl') {
 const defaults={layers:{},monitors:[{name:'DP-1',focused:false},{name:'eDP-1',focused:true,scale:1.5,transform:1}],activewindow:{at:[-500,40],size:[800,600],mapped:true}};
 const subject=args.at(-1);
 console.log(process.env['LUNA_TEST_'+subject.toUpperCase()]??JSON.stringify(defaults[subject]));
} else if(name==='grim') {
 writeFileSync(args.at(-1),process.env.LUNA_TEST_BAD_PNG?'partial':Buffer.from('${png.toString("base64")}','base64'));
 if(process.env.LUNA_TEST_GRIM_FAIL){console.error('capture failed');process.exit(1);}
} else if(name==='tesseract') {
 if(args[0]==='--list-langs') console.log(process.env.LUNA_TEST_LANGUAGES??'eng');
 else {
   process.stdout.write(process.env.LUNA_TEST_TEXT??'Website heading\\nReadable paragraph.');
   if(process.env.LUNA_TEST_OCR_FAIL){console.error('OCR failed');process.exit(1);}
 }
} else if(name==='wl-copy') {
 writeFileSync(root+'/clipboard',readFileSync(0));
 if(process.env.LUNA_TEST_COPY_FAIL){console.error('clipboard unavailable');process.exit(1);}
 if(process.env.LUNA_TEST_COPY_OWNER){
   const owner=Bun.spawn([process.execPath,'-e','await Bun.sleep(2000)'],{stdin:'ignore',stdout:'inherit',stderr:'inherit'});
   writeFileSync(root+'/owner',String(owner.pid));owner.unref();
 }
}
`;
  for (const name of ["grim", "slurp", "hyprctl", "wl-copy", "notify-send", "tesseract"]) {
    const path = join(bin, name);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }
  const calls = () =>
    existsSync(join(root, "calls"))
      ? readFileSync(join(root, "calls"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { name: string; args: string[] })
      : [];
  const capture = (mode: ScreenshotMode = "region", extra: Record<string, string> = {}) =>
    Luna.screenshot.capture(mode, { env: { ...env, ...extra } });
  return { root, home, bin, directory, env, calls, capture };
}

function saved(result: ApiResponse<ScreenshotResult>) {
  if (!result.succes) throw new Error(result.errMessage);
  expect(result.data.cancelled).toBe(false);
  expect(result.data.path).not.toBeNull();
  return result.data.path!;
}

test.each(["region", "screen", "window", "all"] as const)(
  "%s saves PNG and copies it without reinterpreting paths or geometry",
  async (mode) => {
    const f = fixture();
    const path = saved(await f.capture(mode));
    expect(path.startsWith(f.directory + "/Screenshot_")).toBe(true);
    expect(readFileSync(path)).toEqual(png);
    expect(readFileSync(join(f.root, "clipboard"))).toEqual(png);
    const args =
      mode === "region"
        ? ["-g", "-50,30 640x480"]
        : mode === "screen"
          ? ["-o", "eDP-1"]
          : mode === "window"
            ? ["-g", "-500,40 800x600"]
            : [];
    expect(f.calls().find((call) => call.name === "grim")?.args).toEqual([
      "-t",
      "png",
      ...args,
      path,
    ]);
    expect(f.calls().find((call) => call.name === "wl-copy")?.args).toEqual([
      "--type",
      "image/png",
    ]);
    expect(f.calls().find((call) => call.name === "notify-send")?.args).toContain(
      `--hint=string:image-path:${path}`,
    );
  },
);

test.each(["", "selection cancelled", "Selection Canceled"])(
  "Escape (%s) leaves no image, clipboard update, or notification",
  async (message) => {
    const f = fixture();
    expect(
      await f.capture("region", {
        LUNA_TEST_SELECTOR_CODE: "1",
        LUNA_TEST_SELECTOR_ERROR: message,
        LUNA_TEST_REGION: "",
      }),
    ).toEqual({ succes: true, data: { cancelled: true, path: null } });
    expect(existsSync(f.directory)).toBe(false);
    expect(f.calls().some((call) => ["grim", "wl-copy", "notify-send"].includes(call.name))).toBe(
      false,
    );
  },
);

test("selector errors and malformed geometry do not become captures", async () => {
  const f = fixture();
  const selectorFailures: Record<string, string>[] = [
    { LUNA_TEST_SELECTOR_CODE: "1", LUNA_TEST_SELECTOR_ERROR: "failed to connect to display" },
    { LUNA_TEST_REGION: "0,0 0x400; echo bad" },
  ];
  for (const extra of selectorFailures) {
    expect(await f.capture("region", extra)).toMatchObject({
      succes: false,
      err: "COMMAND_FAILED",
    });
  }
  for (const [mode, key, value] of [
    ["window", "ACTIVEWINDOW", '{"at":[true,2],"size":[10,20]}'],
    ["window", "ACTIVEWINDOW", '{"at":[1,2],"size":[0,20]}'],
    ["window", "ACTIVEWINDOW", "{}"],
    ["screen", "MONITORS", "[]"],
    ["screen", "MONITORS", "invalid"],
  ] as const)
    expect(await f.capture(mode, { ["LUNA_TEST_" + key]: value })).toMatchObject({
      succes: false,
      err: "COMMAND_FAILED",
    });
  expect(f.calls().some((call) => call.name === "grim")).toBe(false);
  expect(existsSync(f.directory)).toBe(false);
});

test("capture failures remove partial files while clipboard failures preserve completed images", async () => {
  const f = fixture();
  mkdirSync(f.directory, { recursive: true });
  writeFileSync(join(f.directory, "existing.png"), png);
  const captureFailures: Record<string, string>[] = [
    { LUNA_TEST_BAD_PNG: "1", LUNA_TEST_GRIM_FAIL: "1" },
    { LUNA_TEST_BAD_PNG: "1" },
  ];
  for (const extra of captureFailures) {
    expect(await f.capture("all", extra)).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
    expect(readdirSync(f.directory)).toEqual(["existing.png"]);
  }
  const result = await f.capture("all", { LUNA_TEST_COPY_FAIL: "1" });
  expect(result).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  const image = readdirSync(f.directory).find((name) => name !== "existing.png")!;
  expect(readFileSync(join(f.directory, image))).toEqual(png);
  if (!result.succes) expect(result.errMessage).toContain(join(f.directory, image));
});

test("custom directories, unique filenames, and unavailable notifications preserve captures", async () => {
  const f = fixture();
  const { unlinkSync } = await import("node:fs");
  unlinkSync(join(f.bin, "notify-send"));
  const directory = join(f.root, "custom images ' folder");
  const first = saved(await f.capture("all", { LUNA_SCREENSHOT_DIR: directory }));
  const second = saved(await f.capture("all", { LUNA_SCREENSHOT_DIR: directory }));
  expect(first.startsWith(directory + "/")).toBe(true);
  expect(first).not.toBe(second);
  const override = saved(
    await Luna.screenshot.capture("all", {
      env: { ...f.env, LUNA_SCREENSHOT_DIR: "/unused" },
      directory: "~/captures",
    }),
  );
  expect(override.startsWith(f.home + "/captures/")).toBe(true);
});

test("an in-progress selection rejects a second request and releases the lock on completion", async () => {
  const f = fixture();
  const first = f.capture("region", { LUNA_TEST_BLOCK: "1" });
  try {
    const deadline = Date.now() + 3000;
    while (!existsSync(join(f.root, "selecting")) && Date.now() < deadline) await Bun.sleep(10);
    expect(existsSync(join(f.root, "selecting"))).toBe(true);
    expect(await f.capture("region")).toMatchObject({ succes: false, err: "CONFLICT" });
  } finally {
    writeFileSync(join(f.root, "release"), "");
  }
  saved(await first);
  saved(await f.capture("all"));
});

test("clipboard owners retaining descriptors do not keep a capture open", async () => {
  const f = fixture();
  const pending = f.capture("all", { LUNA_TEST_COPY_OWNER: "1" });
  const completed = await Promise.race([pending, Bun.sleep(1200).then(() => null)]);
  try {
    expect(completed).not.toBeNull();
    if (completed) saved(completed);
  } finally {
    if (existsSync(join(f.root, "owner")))
      try {
        process.kill(Number(readFileSync(join(f.root, "owner"), "utf8")));
      } catch {}
    await pending;
  }
});

test("a menu that remains visible fails before capture and invalid modes fail before tools", async () => {
  const f = fixture();
  expect(
    await f.capture("region", { LUNA_TEST_LAYERS: '{"monitor":[{"namespace":"luna-menu"}]}' }),
  ).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  expect(f.calls().some((call) => call.name === "grim" || call.name === "slurp")).toBe(false);
  const result = await Luna.screenshot.capture("bad" as ScreenshotMode, { env: f.env });
  expect(result).toMatchObject({ succes: false, err: "INVALID_ARGUMENT" });
});

test("text extraction copies English region text and removes temporary captures", async () => {
  const f = fixture();
  const result = await Luna.screenshot.extractText({ env: f.env });
  expect(result).toEqual({
    succes: true,
    data: { cancelled: false, text: "Website heading\nReadable paragraph." },
  });
  expect(readFileSync(join(f.root, "clipboard"), "utf8")).toBe(
    "Website heading\nReadable paragraph.",
  );
  expect(existsSync(f.directory)).toBe(false);
  expect(
    f
      .calls()
      .find((call) => call.name === "grim")
      ?.args.slice(0, 4),
  ).toEqual(["-t", "png", "-g", "-50,30 640x480"]);
  expect(f.calls().find((call) => call.name === "wl-copy")?.args).toEqual([
    "--type",
    "text/plain;charset=utf-8",
  ]);
  expect(
    f
      .calls()
      .find((call) => call.name === "tesseract" && call.args[0] !== "--list-langs")
      ?.args.slice(1),
  ).toEqual([
    "stdout",
    "-l",
    "eng",
    "--oem",
    "1",
    "--psm",
    "6",
    "-c",
    "preserve_interword_spaces=0",
  ]);
  expect(readdirSync(join(f.env.XDG_RUNTIME_DIR!, "luna-screenshot"))).toEqual(["capture.lock"]);
  expect(readFileSync(join(f.home, ".config/luna/screenshot.jsonc"), "utf8")).toBe("{}\n");
});

test("text selection cancellation and empty OCR leave the clipboard untouched", async () => {
  const f = fixture();
  writeFileSync(join(f.root, "clipboard"), "previous clipboard");
  expect(
    await Luna.screenshot.extractText({
      env: { ...f.env, LUNA_TEST_SELECTOR_CODE: "1", LUNA_TEST_REGION: "" },
    }),
  ).toEqual({ succes: true, data: { cancelled: true, text: null } });
  expect(f.calls().some((call) => ["grim", "wl-copy", "notify-send"].includes(call.name))).toBe(
    false,
  );
  expect(await Luna.screenshot.extractText({ env: { ...f.env, LUNA_TEST_TEXT: " \n\t" } })).toEqual(
    { succes: true, data: { cancelled: false, text: "" } },
  );
  expect(f.calls().some((call) => call.name === "wl-copy")).toBe(false);
  expect(f.calls().at(-1)?.args).toContain("No text found");
  expect(readFileSync(join(f.root, "clipboard"), "utf8")).toBe("previous clipboard");
  expect(readdirSync(join(f.env.XDG_RUNTIME_DIR!, "luna-screenshot"))).toEqual(["capture.lock"]);
});

test.each([
  "LUNA_TEST_GRIM_FAIL",
  "LUNA_TEST_BAD_PNG",
  "LUNA_TEST_OCR_FAIL",
  "LUNA_TEST_COPY_FAIL",
])("text extraction reports %s and removes private temporary files", async (failure) => {
  const f = fixture();
  const response = await Luna.screenshot.extractText({ env: { ...f.env, [failure]: "1" } });
  expect(response).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  expect(f.calls().at(-1)?.args).toContain("Text extraction failed");
  if (failure !== "LUNA_TEST_COPY_FAIL")
    expect(f.calls().some((call) => call.name === "wl-copy")).toBe(false);
  expect(readdirSync(join(f.env.XDG_RUNTIME_DIR!, "luna-screenshot"))).toEqual(["capture.lock"]);
  expect(existsSync(f.directory)).toBe(false);
});

test("missing OCR tools or English data fail before selecting a region", async () => {
  for (const missing of ["grim", "slurp", "tesseract", "wl-copy", "eng"]) {
    const f = fixture();
    if (missing !== "eng") rmSync(join(f.bin, missing));
    const response = await Luna.screenshot.extractText({
      env: { ...f.env, LUNA_TEST_LANGUAGES: missing === "eng" ? "fra\neng_custom" : "eng" },
    });
    expect(response).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
    if (!response.succes) expect(response.errMessage).toContain(missing);
    expect(f.calls().some((call) => ["slurp", "grim", "wl-copy"].includes(call.name))).toBe(false);
  }
});

test("text settings reload from explicit JSONC without overwriting the source", async () => {
  const f = fixture();
  const configFile = join(f.root, "custom settings.jsonc");
  for (const [layout, psm] of [
    ["line", "7"],
    ["sparse", "11"],
  ]) {
    const source = `{// my settings\n"text":{"layout":"${layout}","preserve_spaces":true,},}\n`;
    writeFileSync(configFile, source);
    expect(
      await Luna.screenshot.extractText({
        env: { ...f.env, LUNA_SCREENSHOT_DIR: "/" },
        configFile,
      }),
    ).toMatchObject({ succes: true });
    const args = f
      .calls()
      .filter((call) => call.name === "tesseract" && call.args[0] !== "--list-langs")
      .at(-1)!.args;
    expect(args[args.indexOf("--psm") + 1]).toBe(psm!);
    expect(args).toContain("preserve_interword_spaces=1");
    expect(readFileSync(configFile, "utf8")).toBe(source);
  }
  const count = f.calls().filter((call) => call.name === "slurp").length;
  for (const source of [
    '{"text":{"layout":"auto"}}',
    '{"text":{"preserve_spaces":"yes"}}',
    "{broken",
  ]) {
    writeFileSync(configFile, source);
    expect(await Luna.screenshot.extractText({ env: f.env, configFile })).toMatchObject({
      succes: false,
      err: "INVALID_METADATA",
    });
    expect(readFileSync(configFile, "utf8")).toBe(source);
  }
  expect(f.calls().filter((call) => call.name === "slurp")).toHaveLength(count);
});

test("text and image captures share the same interactive selection lock", async () => {
  const f = fixture();
  const first = Luna.screenshot.extractText({ env: { ...f.env, LUNA_TEST_BLOCK: "1" } });
  try {
    const deadline = Date.now() + 3000;
    while (!existsSync(join(f.root, "selecting")) && Date.now() < deadline) await Bun.sleep(10);
    expect(existsSync(join(f.root, "selecting"))).toBe(true);
    expect(await f.capture()).toMatchObject({ succes: false, err: "CONFLICT" });
    expect(await Luna.screenshot.extractText({ env: f.env })).toMatchObject({
      succes: false,
      err: "CONFLICT",
    });
  } finally {
    writeFileSync(join(f.root, "release"), "");
  }
  expect(await first).toMatchObject({ succes: true });
  saved(await f.capture("all"));
});
