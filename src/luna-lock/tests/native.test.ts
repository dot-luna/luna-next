import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

async function fixture() {
  const executable = Bun.which("qs") ?? Bun.which("quickshell");
  if (!executable) throw new Error("Quickshell is required for native Lock checks");
  const root = await mkdtemp(join(tmpdir(), "luna-lock-native-"));
  const env: Record<string, string> = {
    NO_COLOR: "1",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    QT_QPA_PLATFORM: "offscreen",
    QT_QUICK_BACKEND: "software",
    HOME: join(root, "home"),
    PATH: join(root, "bin"),
    XDG_RUNTIME_DIR: join(root, "runtime"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"),
    DBUS_SYSTEM_BUS_ADDRESS: "unix:path=/nonexistent-lock-test-bus",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent-lock-test-bus",
    LUNA_LOCK_TEST_ROOT: root,
  };
  for (const key of [
    "HOME",
    "PATH",
    "XDG_RUNTIME_DIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
  ])
    await mkdir(env[key]!, { mode: 0o700 });
  await cp(new URL("../src/shell", import.meta.url), join(root, "app"), { recursive: true });
  return { root, env, executable };
}

async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(20);
  }
  throw new Error("Native Lock fixture did not become ready");
}

test("native Lock preview compiles, and a broken custom screen falls back without PAM or a session lock", async () => {
  const f = await fixture();
  try {
    const theme = Bun.JSONC.parse(
      await Bun.file(
        new URL("../../../themes/bundled/tokyo-night/theme.jsonc", import.meta.url),
      ).text(),
    );
    await Bun.write(
      join(f.root, "broken/Screen.qml"),
      "import QtQuick\nItem { required property var lock; MissingType {} }\n",
    );
    theme.screen = { path: pathToFileURL(join(f.root, "broken/Screen.qml")).href };
    const file = join(f.root, "app/preview.qml");
    let source = await Bun.file(file).text();
    source =
      source.slice(0, source.lastIndexOf("}")) +
      "    Timer { interval: 500; running: true; onTriggered: Qt.quit() }\n}\n";
    await Bun.write(file, source);
    const child = Bun.spawn([f.executable, "--no-color", "-p", file], {
      env: {
        ...f.env,
        LUNA_LOCK_THEME: JSON.stringify(theme),
        LUNA_LOCK_USER: "jrtilak",
        LUNA_LOCK_USER_ICON: "",
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, stdout + stderr).toBe(0);
    expect(stdout + stderr).toContain("using the default screen");
    expect(stdout + stderr).not.toMatch(
      /ReferenceError|TypeError|Binding loop|Unable to assign|FATAL|has crashed/,
    );
    expect(source).not.toContain("PamContext");
    expect(source).not.toContain("WlSessionLock");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}, 10_000);

test("native power adapter filters capabilities, cancels shutdown, and sends noninteractive requests to a private fake busctl", async () => {
  const f = await fixture();
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let output: Promise<string[]> | undefined;
  try {
    const busctl = join(f.env.PATH!, "busctl");
    await Bun.write(
      busctl,
      `#!${process.execPath}
import {appendFileSync,existsSync} from 'node:fs';
const args=Bun.argv.slice(2);
const method=args[args.indexOf('org.freedesktop.login1.Manager')+1];
appendFileSync(Bun.env.LUNA_LOCK_TEST_ROOT+'/commands.jsonl',JSON.stringify(args)+'\\n');
if(method.startsWith('Can')) console.log(JSON.stringify({type:'s',data:[method==='CanHibernate'?'challenge':method==='CanHybridSleep'?'no':'yes']}));
else if(existsSync(Bun.env.LUNA_LOCK_TEST_ROOT+'/fail')) {console.error('fixture failure');process.exit(1);}
`,
    );
    await chmod(busctl, 0o755);
    await Bun.write(
      join(f.root, "shell.qml"),
      `import QtQuick
import Quickshell
import Quickshell.Io
import "app" as Lock
ShellRoot {
    id: shell
    Lock.SystemActions { id: actions }
    IpcHandler {
        target: "test"
        function state(): string { return JSON.stringify({supported: actions.supportedActions, ready: actions.capabilityIndex === actions.names.length,
            active: actions.shutdownActive, committed: actions.committed, secure: actions.secure, error: actions.errorMessage, busy: actions.busy}); }
        function secure(value: bool): void { actions.secure = value; }
        function delay(value: int): void { actions.shutdownDelay = value; }
        function request(value: string): bool { return actions.requestAction(value); }
        function cancel(): bool { return actions.cancelShutdown(); }
        function stop(): void { Qt.callLater(Qt.quit); }
    }
    Component.onCompleted: Quickshell.watchFiles = false
}
`,
    );
    child = Bun.spawn([f.executable, "--no-color", "-p", f.root], {
      env: f.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const call = async (method: string, ...args: string[]) => {
      const request = Bun.spawn(
        [f.executable, "ipc", "-p", f.root, "call", "--", "test", method, ...args],
        { env: f.env, stdout: "pipe", stderr: "ignore", timeout: 1500 },
      );
      const text = await new Response(request.stdout).text();
      return (await request.exited) === 0 ? text.trim() : "";
    };
    const state = async () => JSON.parse(await call("state"));
    await until(async () => {
      const text = await call("state");
      return text !== "" && JSON.parse(text).ready;
    });
    expect((await state()).supported).toEqual(["suspend", "reboot", "powerOff"]);
    expect(await call("request", "powerOff")).toBe("false");
    await call("secure", "true");
    expect(await call("request", "hibernate")).toBe("false");
    expect(await call("request", "powerOff")).toBe("true");
    expect(await call("cancel")).toBe("true");
    const commands = async (): Promise<string[][]> =>
      (await Bun.file(join(f.root, "commands.jsonl")).text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    expect((await commands()).every((args) => args.at(-1)!.startsWith("Can"))).toBe(true);
    await Bun.write(join(f.root, "fail"), "");
    expect(await call("request", "suspend")).toBe("true");
    await until(async () => (await state()).error !== "");
    expect(await state()).toMatchObject({
      secure: true,
      active: false,
      error: "Power action failed.",
    });
    await rm(join(f.root, "fail"));
    await call("delay", "0");
    expect(await call("request", "powerOff")).toBe("true");
    await until(async () => (await commands()).some((args) => args.includes("PowerOff")));
    expect(await call("request", "powerOff")).toBe("false");
    expect(await call("cancel")).toBe("false");
    expect((await commands()).filter((args) => args.includes("PowerOff"))).toHaveLength(1);
    expect((await commands()).find((args) => args.includes("PowerOff"))!.slice(-3)).toEqual([
      "PowerOff",
      "b",
      "false",
    ]);
    expect((await state()).secure).toBe(true);
    await call("stop");
    expect(await child.exited).toBe(0);
    const logs = (await output).join("\n");
    expect(logs).not.toMatch(
      /ReferenceError|TypeError|Binding loop|Unable to assign|FATAL|has crashed/,
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await child.exited;
    }
    await output;
    await rm(f.root, { recursive: true, force: true });
  }
}, 15_000);
