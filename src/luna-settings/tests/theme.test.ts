import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("Appearance mock supports galleries, dialogs, navigation, theme styling, and capped content width", async () => {
  const runner = Bun.which("qmltestrunner-qt6") ?? "/usr/lib/qt6/bin/qmltestrunner";
  if (!existsSync(runner))
    throw new Error("Install Qt 6 Declarative's qmltestrunner to check Settings");
  const child = Bun.spawn(
    [runner, "-input", fileURLToPath(new URL("./tst_theme.qml", import.meta.url))],
    {
      env: {
        ...Bun.env,
        QT_QPA_PLATFORM: "offscreen",
        QT_QUICK_BACKEND: "rhi",
        QSG_RHI_BACKEND: "opengl",
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0 || /QWARN|ReferenceError|TypeError/.test(stdout + stderr))
    throw new Error(`Qt Settings checks exited ${code}\n${stdout}\n${stderr}`);
  expect(stdout).toContain("0 failed");
}, 20_000);
