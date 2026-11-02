import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const app = new URL("../../../apps/yay/", import.meta.url).pathname;

test("yay installs from its build workspace and propagates makepkg failures", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-yay-test-"));
  try {
    const cloneRoot = join(root, "git clones");
    const clone = join(cloneRoot, "yay");
    const bin = join(root, "bin");
    mkdirSync(clone, { recursive: true });
    mkdirSync(bin);
    const makepkg = join(bin, "makepkg");
    writeFileSync(
      makepkg,
      '#!/bin/bash\nprintf "%s\\n" "$PWD" "$@"\nexit "$LUNA_TEST_EXIT_CODE"\n',
    );
    chmodSync(makepkg, 0o755);
    for (const exitCode of [0, 7]) {
      const result = Bun.spawnSync([join(app, "scripts/install.sh")], {
        cwd: app,
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          LUNA_GIT_APP_BUILD_DIR: cloneRoot,
          LUNA_TEST_EXIT_CODE: String(exitCode),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(exitCode);
      expect(result.stdout.toString().trim().split("\n")).toEqual([
        clone,
        "--syncdeps",
        "--install",
        "--rmdeps",
        "--clean",
        "--needed",
        "--noconfirm",
      ]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("yay refuses to build without the build workspace directory", () => {
  const result = Bun.spawnSync([join(app, "scripts/install.sh")], {
    cwd: app,
    env: { PATH: "/usr/bin:/bin" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("LUNA_GIT_APP_BUILD_DIR must be set");
});
