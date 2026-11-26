import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("Quickshell serializes background requests and preserves confirmed state after errors", async () => {
  const executable = Bun.which("qs") ?? Bun.which("quickshell");
  if (!executable) throw new Error("Install Quickshell to test the Settings background bridge");
  const root = await mkdtemp(join(tmpdir(), "luna-settings-bridge-"));
  await copyFile(
    new URL("./fixtures/background-controller.qml", import.meta.url),
    join(root, "shell.qml"),
  );
  await copyFile(
    new URL("../src/shell/BackgroundController.qml", import.meta.url),
    join(root, "BackgroundController.qml"),
  );
  try {
    const child = Bun.spawn([executable, "-p", root], {
      env: {
        ...Bun.env,
        WAYLAND_DISPLAY: "",
        QT_QPA_PLATFORM: "offscreen",
        QT_QUICK_BACKEND: "software",
        LUNA_SETTINGS_TEST_BRIDGE: JSON.stringify([
          process.execPath,
          fileURLToPath(new URL("./fixtures/background-bridge.ts", import.meta.url)),
        ]),
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, stdout + stderr).toBe(0);
    expect(stdout + stderr).toContain("BACKGROUND_CONTROLLER_PASSED");
    expect(stdout + stderr).not.toMatch(/ReferenceError|TypeError|QML.*(Error|Warning)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
