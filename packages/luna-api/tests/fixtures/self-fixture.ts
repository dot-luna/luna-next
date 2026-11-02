import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const realGit = Bun.which("git")!;
const bash = Bun.which("bash")!;
const mock = resolve(import.meta.dir, "self-command.ts");
const gitHook = resolve(import.meta.dir, "../../../../apps/git/scripts/after-install.sh");
const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";

export interface CommandRecord {
  name: string;
  args: string[];
  cwd: string;
  repository: string;
}

export class SelfFixture {
  root = mkdtempSync(join(tmpdir(), "luna self ' "));
  home = join(this.root, "home");
  repository = join(this.root, "checkout");
  upstream = join(this.root, "upstream");
  bin = join(this.root, "bin");
  log = join(this.root, "commands.jsonl");
  executable = join(this.home, ".local/bin/luna");
  env: Record<string, string> = {
    HOME: this.home,
    PATH: this.bin,
    LUNA_ROOT: this.repository,
    SELF_LOG: this.log,
    SELF_BIN: this.bin,
    SELF_REAL_GIT: realGit,
    SELF_REMOTE: this.upstream,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };

  constructor() {
    for (const path of [this.home, this.bin, this.upstream]) mkdirSync(path);
    symlinkSync(bash, join(this.bin, "bash"));
    for (const tool of ["flock", "mv"]) symlinkSync(Bun.which(tool)!, join(this.bin, tool));
    for (const name of ["git", "pacman", "yay", "sudo", "mise", "bun", "gsettings"]) {
      writeFileSync(
        join(this.bin, name),
        `#!${bash}\nexec ${[process.execPath, mock, name].map(quote).join(" ")} "$@"\n`,
        { mode: 0o755 },
      );
    }
    this.git(this.upstream, ["init", "--initial-branch=master"]);
    this.write(
      this.upstream,
      "package.json",
      JSON.stringify({ name: "Luna", version: "1.0.0", description: "Fixture" }),
    );
    this.write(
      this.upstream,
      "installs/packages.jsonc",
      JSON.stringify({
        before_cli: [
          { name: "mise", source: "pacman" },
          { name: "neovim", source: "pacman" },
        ],
        after_cli: [{ name: "gcc", source: "pacman" }],
        later: [{ name: "zed", source: "pacman" }],
      }),
    );
    this.write(
      this.upstream,
      "installs/packages.mise.jsonc",
      '[{"name":"node","source":"mise","version":"lts"}]',
    );
    this.write(this.upstream, "apps/apps.jsonc", '{"packages":[]}');
    this.write(this.upstream, "installs/packages.webapp.jsonc", "[]");
    this.write(this.upstream, "apps/git/scripts/after-install.sh", readFileSync(gitHook, "utf8"));
    this.write(this.upstream, "themes/bundled/tokyo-night/theme.jsonc", "{}");
    this.write(this.upstream, ".gitignore", "target/\n");
    this.commit("Initial fixture");
    this.git(this.root, ["clone", this.upstream, this.repository]);
    this.git(this.repository, [
      "remote",
      "set-url",
      "origin",
      "https://github.com/dot-luna/luna-next.git",
    ]);
    this.previousBinary();
  }

  git(cwd: string, args: string[]) {
    const result = Bun.spawnSync([realGit, "-C", cwd, ...args], {
      env: {
        ...this.env,
        GIT_AUTHOR_NAME: "Fixture Author",
        GIT_AUTHOR_EMAIL: "author@example.test",
        GIT_COMMITTER_NAME: "Fixture Author",
        GIT_COMMITTER_EMAIL: "author@example.test",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  }

  write(root: string, path: string, contents: string) {
    const destination = join(root, path);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    writeFileSync(destination, contents);
  }

  commit(message: string, cwd = this.upstream) {
    this.git(cwd, ["add", "."]);
    this.git(cwd, ["commit", "-m", message]);
  }

  previousBinary() {
    this.write(this.home, ".local/bin/luna", "previous CLI");
  }

  commands(): CommandRecord[] {
    try {
      return readFileSync(this.log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  dispose() {
    rmSync(this.root, { recursive: true, force: true });
  }
}
