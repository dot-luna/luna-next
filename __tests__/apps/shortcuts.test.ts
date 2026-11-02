import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function shortcut(app: string) {
  const result = Bun.spawnSync([
    "lua",
    "-e",
    `
hl = {
  window_rule = function() end,
  dsp = { exec_cmd = function(command) return command end },
  bind = function(_, command) print(command) end,
}
dofile(arg[1])
`,
    "--",
    fileURLToPath(new URL(`../../apps/${app}/config/hyprland.lua`, import.meta.url)),
  ]);
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return result.stdout.toString().trim();
}

function executable(root: string, name: string, body: string) {
  const path = join(root, "bin", name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

test("Bitwarden's shortcut launches the installed desktop executable", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-shortcuts "));
  try {
    mkdirSync(join(root, "bin"));
    executable(root, "bitwarden-desktop", "printf 'Bitwarden launched'");
    const result = Bun.spawnSync(["bash", "-c", shortcut("bitwarden")], {
      env: { HOME: root, PATH: `${join(root, "bin")}:/usr/bin:/bin` },
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toBe("Bitwarden launched");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const status of [0, 23]) {
  test(`Fastfetch keeps only its output until a silent keypress, preserving exit ${status}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "luna-shortcuts "));
    mkdirSync(join(root, "bin"));
    executable(root, "fastfetch", `printf 'FASTFETCH_OUTPUT\\n'; exit ${status}`);
    executable(
      root,
      "xdg-terminal-exec",
      `
printf '%s\\n' "$@" > "$HOME/terminal-args"
while (( $# )); do
  if [[ $1 == -- ]]; then shift; exec "$@"; fi
  shift
done
exit 99`,
    );
    let output = "";
    await using terminal = new Bun.Terminal({
      data(_, data) {
        output += new TextDecoder().decode(data);
      },
    });
    const child = Bun.spawn(["bash", "-c", shortcut("fastfetch")], {
      env: { HOME: root, PATH: `${join(root, "bin")}:/usr/bin:/bin`, PS1: "UNWANTED_SHELL_PROMPT" },
      terminal,
    });
    try {
      // ECHO is disabled only once Bash is waiting in its silent read on this PTY.
      for (let attempt = 0; attempt < 200; attempt++) {
        if (output.includes("FASTFETCH_OUTPUT") && (terminal.localFlags & 8) === 0) break;
        await Bun.sleep(10);
      }
      expect(child.exitCode).toBeNull();
      expect(terminal.localFlags & 8).toBe(0);
      expect(output).toBe("FASTFETCH_OUTPUT\r\n");
      const args = readFileSync(join(root, "terminal-args"), "utf8");
      expect(args).toContain("--app-id=luna-next-fastfetch\n--title=Fastfetch\n");
      expect(args).not.toContain("--hold");
      terminal.write("x");
      expect(await child.exited).toBe(status);
      expect(output).toBe("FASTFETCH_OUTPUT\r\n");
    } finally {
      child.kill();
      await child.exited;
      rmSync(root, { recursive: true, force: true });
    }
  });
}
