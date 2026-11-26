import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entry = resolve(import.meta.dir, "../src/index.ts");
const repository = resolve(import.meta.dir, "../../..");
let root: string;
let config: string;
let system: string;
let env: Record<string, string>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "luna login CLI ' "));
  config = join(root, "login.jsonc");
  system = join(root, "system");
  env = { HOME: join(root, "home"), PATH: "/usr/bin:/bin", NO_COLOR: "1" };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, entry, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}
const login = (args: string[]) =>
  cli(["login", "--config", config, "--install-dir", repository, "--system-root", system, ...args]);

test("login reads and patches sparse settings, reports argument errors, and builds portable themes", async () => {
  expect(JSON.parse((await login(["get", "--json"])).stdout)).toEqual({ succes: true, data: {} });
  expect((await login(["get-config-file"])).stdout).toBe(config + "\n");
  const update = await login([
    "configure",
    '{"login":{"user":"alice"},"actions":{"shutdown_delay":5}}',
    "--json",
  ]);
  expect(update.code, update.stderr + update.stdout).toBe(0);
  expect(JSON.parse(update.stdout)).toMatchObject({
    succes: true,
    data: { login: { user: "alice" } },
  });
  expect((await login(["get", "login.user"])).stdout).toBe("alice\n");
  expect(JSON.parse((await login(["get", "missing", "--json"])).stdout)).toEqual({
    succes: true,
    data: null,
  });
  const output = join(root, "bundle ;$(touch forbidden)");
  const built = await login(["build", output, "--json"]);
  expect(built.code, built.stderr + built.stdout).toBe(0);
  expect(JSON.parse(built.stdout)).toEqual({ succes: true, data: output });
  expect(await Bun.file(join(output, "Main.qml")).exists()).toBe(true);
  const before = await Bun.file(config).text();
  expect((await login(["configure", "not json", "--json"])).code).toBe(2);
  expect((await login(["configure", '{"login":{"session":"plasma"}}', "--json"])).code).toBe(1);
  expect(await Bun.file(config).text()).toBe(before);
});

test("login install, status, and uninstall change only the isolated SDDM root", async () => {
  expect((await login(["status"])).stdout).toBe("Login: not installed\n");
  const installed = await login(["install", "--json"]);
  expect(installed.code, installed.stderr + installed.stdout).toBe(0);
  expect(JSON.parse(installed.stdout)).toMatchObject({
    succes: true,
    data: { installed: true, selected: true },
  });
  expect((await login([])).stdout).toBe("Login: selected\n");
  expect((await login(["uninstall", "--json"])).code).toBe(0);
  expect((await login(["status"])).stdout).toBe("Login: not installed\n");
});

test("wallpaper set --login changes Login alone and subsequent calls replace its managed image", async () => {
  const desktop = join(root, "desktop.jsonc");
  const original = '// desktop\n{"wallpaper":{"source":"/desktop.png"}}\n';
  await Bun.write(desktop, original);
  const image = join(root, "image.png");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7xkAAAAASUVORK5CYII=",
    "base64",
  );
  await Bun.write(image, png);
  const set = await cli([
    "wallpaper",
    "--config",
    desktop,
    "set",
    image,
    "--login",
    "--login-config",
    config,
    "--system-root",
    system,
    "--json",
  ]);
  expect(set.code, set.stderr + set.stdout).toBe(0);
  const settings = JSON.parse(set.stdout).data;
  expect(Buffer.from(await Bun.file(settings.background.path).arrayBuffer())).toEqual(png);
  expect(await Bun.file(desktop).text()).toBe(original);
  await Bun.write(image, Buffer.concat([png, Buffer.from("new image")]));
  expect((await login(["wallpaper", image])).stdout).toBe("Login wallpaper updated.\n");
  expect(Buffer.from(await Bun.file(settings.background.path).arrayBuffer())).toEqual(
    Buffer.concat([png, Buffer.from("new image")]),
  );
  expect((await cli(["wallpaper", "set", image, "--login-config", config, "--json"])).code).toBe(2);
});

test("preview invokes only SDDM test mode and cleans up its temporary theme", async () => {
  const bin = join(root, "bin");
  await mkdir(bin);
  const executable = join(bin, "sddm-greeter-qt6");
  const log = join(root, "preview.json");
  await Bun.write(
    executable,
    `#!${process.execPath}\nawait Bun.write(${JSON.stringify(log)},JSON.stringify(Bun.argv.slice(2)));\n`,
  );
  await chmod(executable, 0o755);
  env.PATH = bin + ":/usr/bin:/bin";
  const result = await login(["preview", "--json"]);
  expect(result.code, result.stderr + result.stdout).toBe(0);
  const args = await Bun.file(log).json();
  expect(args.slice(0, 2)).toEqual(["--test-mode", "--theme"]);
  expect(await Bun.file(join(args[2], "Main.qml")).exists()).toBe(false);
});
