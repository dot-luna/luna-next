import { expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaults } from "../../../packages/luna-api/src/theme/defaults.ts";

test("generated Kitty colors are valid hex values with no template punctuation", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-kitty "));
  try {
    cpSync(new URL("../config", import.meta.url), join(root, "config"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    cpSync(new URL("../scripts/configure.ts", import.meta.url), join(root, "scripts/configure.ts"));
    mkdirSync(join(root, "bin"));
    const cli = join(root, "bin/luna");
    writeFileSync(
      cli,
      `#!${process.execPath}\nconsole.log(JSON.stringify(${JSON.stringify({ succes: true, data: defaults })}));\n`,
    );
    chmodSync(cli, 0o755);
    const result = Bun.spawnSync([process.execPath, join(root, "scripts/configure.ts")], {
      env: { HOME: root, PATH: join(root, "bin") + ":/usr/bin:/bin" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const theme = readFileSync(join(root, "generated/theme.conf"), "utf8");
    const colors = theme
      .split("\n")
      .filter((line) =>
        /^(?:color\d+|background|foreground|cursor|cursor_text_color|selection_\w+|\w+_color|\w+_background|\w+_foreground)\s/u.test(
          line,
        ),
      );
    expect(colors.length).toBeGreaterThan(20);
    for (const line of colors) expect(line).toMatch(/^\w+\s+#[0-9a-fA-F]{6}$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
