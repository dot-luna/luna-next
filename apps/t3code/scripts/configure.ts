#!/usr/bin/env bun
/**
 * after_configure: apply Luna's resolved theme using its native T3 adapter.
 * Run with system Bun: bun apps/t3code/scripts/configure.ts
 *
 * The Luna CLI resolves and validates colors/fonts, then atomically publishes T3's
 * environment-theme and client settings. It also enables math rendering, retains
 * unrelated preferences, and honors T3CODE_HOME. Theme failures stop configuration.
 * Palette/font updates need no rebuild; restart T3 after font changes.
 */
const result = Bun.spawnSync(["luna", "theme", "apply", "t3code"], {
  stdin: "ignore", stdout: "inherit", stderr: "inherit", timeout: 30_000,
});
if (!result.success) {
  console.error("Configure T3 Code: Luna could not apply the theme.");
  process.exitCode = result.exitCode || 1;
}
