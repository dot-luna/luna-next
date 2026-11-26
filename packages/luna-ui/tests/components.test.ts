import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("shared QML components support themes, native actions, mouse, keyboard, and disabled states", async () => {
  const runner = Bun.which("qmltestrunner-qt6") ?? "/usr/lib/qt6/bin/qmltestrunner";
  if (!existsSync(runner)) throw new Error("Install Qt 6 Declarative to test Luna UI");
  const child = Bun.spawn(
    [runner, "-import", `${root}src`, "-input", `${root}tests/tst_components.qml`],
    {
      env: { ...Bun.env, QT_QPA_PLATFORM: "offscreen", QT_QUICK_BACKEND: "software" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
  expect(stdout).toContain("0 failed");
  expect(stdout + stderr).not.toMatch(/QWARN|ReferenceError|TypeError/);
}, 25_000);
