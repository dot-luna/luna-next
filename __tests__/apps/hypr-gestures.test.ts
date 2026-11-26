import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const hyprland = Bun.which("Hyprland");

for (const nativeFirst of [false, true]) {
  test.skipIf(!hyprland)(
    `Luna input can load ${nativeFirst ? "after" : "before"} a native swipe gesture`,
    () => {
      const root = mkdtempSync(join(tmpdir(), "luna-hypr-gesture-"));
      try {
        const path = join(root, "hyprland.lua");
        const luna = `dofile(${JSON.stringify(resolve(import.meta.dir, "../../apps/hypr/config/input.lua"))})`;
        const native =
          'hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })';
        writeFileSync(path, (nativeFirst ? [native, luna] : [luna, native]).join("\n"));
        // The verifier parses configuration without starting or reloading the user's session.
        const result = Bun.spawnSync([hyprland!, "--verify-config", "--config", path], {
          env: { ...process.env, HOME: root, XDG_CONFIG_HOME: root },
          stdout: "pipe",
          stderr: "pipe",
          timeout: 10_000,
        });
        const output = result.stdout.toString() + result.stderr.toString();
        expect(output).not.toContain("overshadowed");
        expect(result.exitCode, output).toBe(0);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}
