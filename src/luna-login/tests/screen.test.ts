import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLogin } from "../../../packages/luna-api/src/modules/login/build.ts";

test("login screen keyboard, pointer, animation, and shutdown behavior", async () => {
  const runner = Bun.which("qmltestrunner-qt6") ?? "/usr/lib/qt6/bin/qmltestrunner";
  if (!existsSync(runner))
    throw new Error("Install Qt 6 Declarative's qmltestrunner to test the login screen.");
  const root = await mkdtemp(join(tmpdir(), "luna-login-screen-"));
  try {
    const sourceDirectory = new URL("../src", import.meta.url).pathname;
    const configFile = join(root, "config.jsonc");
    await Bun.write(configFile, "{}");
    await buildLogin({ configFile, sourceDirectory, output: join(root, "theme") });
    await Bun.write(
      configFile,
      JSON.stringify({
        theme: { fonts: { ui: "serif" }, appearance: { rounding: 18, blur: { enabled: false } } },
      }),
    );
    await buildLogin({ configFile, sourceDirectory, output: join(root, "rounded-theme") });
    const checks = join(root, "checks");
    await mkdir(checks);
    await copyFile(
      new URL("./fixtures/tst_screen.qml", import.meta.url),
      join(checks, "tst_screen.qml"),
    );
    const process = Bun.spawn([runner, "-input", checks], {
      env: {
        ...Bun.env,
        QT_QPA_PLATFORM: "offscreen",
        QT_QUICK_BACKEND: "rhi",
        QSG_RHI_BACKEND: "opengl",
        QT_LOGGING_TO_CONSOLE: "1",
        QT_FORCE_STDERR_LOGGING: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 25_000,
    });
    const [code, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    if (code !== 0 || /QWARN|QML.*Error|ReferenceError|TypeError/.test(stdout + stderr))
      throw new Error(`Qt login checks exited ${code}\n${stdout}\n${stderr}`);
    expect(stdout).toContain("0 failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
