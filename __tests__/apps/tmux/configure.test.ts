import { expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Luna } from "../../../packages/luna-api/src/index.ts";
import { AppFixture } from "../../../packages/luna-api/tests/fixtures/app-fixture.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

async function configure(personal: string) {
  const f = new AppFixture();
  cpSync(join(repo, "apps/tmux"), join(f.repository, "apps/tmux"), { recursive: true });
  f.write(f.repository, "apps/apps.jsonc", '{"packages":["tmux/app.jsonc"]}');
  f.write(f.home, personal, "set -g status-position bottom\n");
  const options = { repository: f.repository, env: f.env };
  expect(await Luna.apps.configure(["tmux"], options)).toMatchObject({ succes: true });
  expect(await Luna.apps.configure(["tmux"], options)).toMatchObject({ succes: true });
  return f;
}

test("tmux sources Luna's status layout before personal settings", async () => {
  const f = await configure(".config/tmux/tmux.conf");
  try {
    const config = join(f.home, ".config/tmux/tmux.conf");
    const text = readFileSync(config, "utf8");
    // The fixture path contains a quote; real tmux below proves the escaped path loads.
    expect(text.match(/^source .*\/\.config\/luna\/tmux\/luna\.tmux'$/gmu)).toHaveLength(1);
    expect(text.endsWith("set -g status-position bottom\n")).toBe(true);
    expect(existsSync(join(f.home, ".tmux.conf"))).toBe(false);

    f.write(
      f.bin,
      "tmux",
      `#!${process.execPath}\nconsole.log(JSON.stringify(Bun.argv.slice(2)));\n`,
    );
    chmodSync(join(f.bin, "tmux"), 0o755);
    const aliases = join(f.home, ".config/luna/aliases/tmux.zsh");
    const alias = Bun.spawnSync(
      [Bun.which("zsh")!, "-fc", `source ${JSON.stringify(aliases)}; eval t`],
      {
        env: { PATH: f.bin },
      },
    );
    expect(alias.exitCode, alias.stderr.toString()).toBe(0);
    expect(JSON.parse(alias.stdout.toString())).toEqual(["new-session", "-A", "-s", "main"]);

    const tmux = Bun.which("tmux");
    if (!tmux) return;
    const socket = join(f.root, "tmux.sock");
    const result = Bun.spawnSync(
      [
        tmux,
        "-S",
        socket,
        "-f",
        config,
        "new-session",
        "-d",
        ";",
        "show",
        "-g",
        "status-left",
        ";",
        "show",
        "-g",
        "status-position",
        ";",
        "kill-server",
      ],
      { env: { HOME: f.home, PATH: "/usr/bin:/bin" } },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const shown = result.stdout.toString();
    expect(shown).toContain('status-left "#[fg=black,bg=blue,bold] #S #[bg=default] "');
    expect(shown).toContain("status-position bottom");
  } finally {
    f.dispose();
  }
});

test("tmux keeps using an existing ~/.tmux.conf", async () => {
  const f = await configure(".tmux.conf");
  try {
    expect(readFileSync(join(f.home, ".tmux.conf"), "utf8")).toContain("luna.tmux'");
    expect(existsSync(join(f.home, ".config/tmux/tmux.conf"))).toBe(false);
  } finally {
    f.dispose();
  }
});
