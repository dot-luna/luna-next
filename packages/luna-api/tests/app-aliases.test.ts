import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, existsSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Luna, type ApiResponse } from "../src/index.ts";
import { AppFixture } from "./fixtures/app-fixture.ts";

let f: AppFixture;
beforeEach(() => {
  f = new AppFixture();
});
afterEach(() => f.dispose());

function data<T>(result: ApiResponse<T>): T {
  if (!result.succes) throw new Error(result.errMessage);
  return result.data;
}

function shell(personal = "") {
  f.env.ZDOTDIR = join(f.root, "custom zsh home");
  f.write(f.env.ZDOTDIR, ".zshrc", personal);
  f.app("zsh", {
    name: "zsh",
    source: "local",
    exports: [
      { source: "config", target: "zsh", exclude: ["zshrc"] },
      {
        source: "config/zshrc",
        target: "zsh/zshrc",
        user_config: {
          dest: ["$ZDOTDIR/.zshrc"],
          dest_mode: "include",
        },
      },
    ],
  });
  cpSync(
    new URL("../../../apps/zsh/config", import.meta.url),
    join(f.repository, "apps/zsh/config"),
    { recursive: true },
  );
}

function run(command: string) {
  return Bun.spawnSync([Bun.which("zsh")!, "-d", "-i", "-c", command], {
    env: f.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
}

function executable(name: string) {
  writeFileSync(
    join(f.bin, name),
    `#!${process.execPath}\nconsole.log(JSON.stringify(Bun.argv.slice(2)));\nprocess.exit(7);\n`,
    { mode: 0o755 },
  );
}

test("configured app aliases run in Zsh, forward arguments and retain the command exit status", async () => {
  f.app("fastfetch", { name: "fastfetch", source: "local", alias: ["ff"] });
  f.app("glow", { name: "glow", source: "local", alias: ["md"] });
  f.app("luna-menu", {
    name: "luna-menu",
    source: "local",
    alias: [["menu", ["luna", "menu"]]],
  });
  shell();
  executable("fastfetch");
  executable("glow");
  writeFileSync(
    f.executable,
    `#!${process.execPath}\nconsole.log(JSON.stringify(Bun.argv.slice(2)));\nprocess.exit(7);\n`,
    { mode: 0o755 },
  );
  data(await Luna.apps.configure([], { env: f.env }));

  for (const [command, args] of [
    ["ff 'two words' \"quote's\" '--flag'", ["two words", "quote's", "--flag"]],
    ["md 'read me.md'", ["read me.md"]],
    ["menu toggle", ["menu", "toggle"]],
  ] as const) {
    const result = run(command);
    expect(result.exitCode, result.stderr.toString()).toBe(7);
    expect(JSON.parse(result.stdout.toString())).toEqual(args);
  }
});

test("shell aliases are not app selectors and unconfigured apps do not publish aliases", async () => {
  f.app("fetch", { name: "fastfetch", source: "local", alias: ["ff"] });
  f.app("glow", { name: "glow", source: "local", alias: ["md"] });
  for (const operation of [Luna.apps.install, Luna.apps.configure]) {
    expect(await operation(["ff"], { env: f.env })).toMatchObject({
      succes: false,
      err: "INVALID_ARGUMENT",
    });
  }
  expect(f.commands()).toEqual([]);
  data(await Luna.apps.configure(["fastfetch"], { env: f.env }));
  expect(existsSync(join(f.home, ".config/luna/aliases/fetch.zsh"))).toBe(true);
  expect(existsSync(join(f.home, ".config/luna/aliases/glow.zsh"))).toBe(false);
});

test("alias regeneration replaces removed names, quotes fixed arguments and preserves personal overrides", async () => {
  const fixed = "a 'quote'; $(touch should-not-exist) `echo no`";
  f.app("fastfetch", { name: "fastfetch", source: "local", alias: ["ff", "oldff"] });
  f.app("glow", { name: "glow", source: "local", alias: ["md"] });
  shell("alias ff='printf personal-alias'\n");
  f.write(f.env.ZDOTDIR!, ".zshenv", "md() { printf personal-function; }\n");
  executable("fastfetch");
  data(await Luna.apps.configure([], { env: f.env }));
  f.write(
    f.repository,
    "apps/fastfetch/app.jsonc",
    JSON.stringify({
      name: "fastfetch",
      source: "local",
      alias: ["ff", ["newff", ["fastfetch", fixed]]],
    }),
  );
  data(await Luna.apps.configure(["fastfetch", "zsh"], { env: f.env }));
  const result = run(
    "source \"$ZDOTDIR/.zshrc\"\nff; printf '\\n'; md; printf '\\n'; (( ! $+aliases[oldff] )) || exit 99; newff extra",
  );
  expect(result.exitCode, result.stderr.toString()).toBe(7);
  expect(result.stderr.toString()).toBe("");
  const lines = result.stdout.toString().trim().split("\n");
  expect(lines, result.stderr.toString()).toHaveLength(3);
  expect(lines.slice(0, 2)).toEqual(["personal-alias", "personal-function"]);
  expect(JSON.parse(lines[2]!)).toEqual([fixed, "extra"]);
  f.write(f.repository, "apps/fastfetch/app.jsonc", '{"name":"fastfetch","source":"local"}');
  data(await Luna.apps.configure(["fastfetch"], { env: f.env }));
  const cleared = run("(( ! $+aliases[newff] ))");
  expect(cleared.exitCode, cleared.stderr.toString()).toBe(0);
});

test("duplicate aliases and linked alias destinations are rejected without overwriting outside files", async () => {
  f.app("first", { name: "first", source: "local", alias: ["same"] });
  f.app("second", { name: "second", source: "local", alias: ["same"] });
  expect(await Luna.apps.configure([], { env: f.env })).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  f.entries = [];
  f.app("first", { name: "first", source: "local", alias: ["same"] });
  f.write(f.home, ".config/luna/aliases/first.zsh", "old");
  const outside = join(f.root, "outside");
  f.write(f.root, "outside", "keep");
  unlinkSync(join(f.home, ".config/luna/aliases/first.zsh"));
  symlinkSync(outside, join(f.home, ".config/luna/aliases/first.zsh"));
  expect(await Luna.apps.configure([], { env: f.env })).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
  expect(readFileSync(outside, "utf8")).toBe("keep");
});
