import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Lock screen resting, password, pointer, focus, and secret disposal", async () => {
  const runner = Bun.which("qmltestrunner-qt6") ?? "/usr/lib/qt6/bin/qmltestrunner";
  if (!existsSync(runner)) throw new Error("Qt 6 qmltestrunner is required for Lock UI tests");
  const root = await mkdtemp(join(tmpdir(), "luna-lock-screen-"));
  try {
    await cp(new URL("../src", import.meta.url), join(root, "src"), { recursive: true });
    await cp(new URL("./fixtures", import.meta.url), join(root, "tests/fixtures"), {
      recursive: true,
    });
    await Bun.write(
      join(root, "tests/fixtures/tst_screen.qml"),
      "import QtQuick\nLockViewTests {}\n",
    );
    const child = Bun.spawn([runner, "-input", join(root, "tests/fixtures")], {
      env: {
        ...Bun.env,
        QT_QPA_PLATFORM: "offscreen",
        QT_QUICK_BACKEND: "rhi",
        QSG_RHI_BACKEND: "opengl",
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 25_000,
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (
      code !== 0 ||
      /QWARN|ReferenceError|TypeError|Binding loop|Unable to assign/.test(stdout + stderr)
    )
      throw new Error(`Qt Lock checks exited ${code}\n${stdout}\n${stderr}`);
    expect(stdout).toContain("0 failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
