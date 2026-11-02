import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run: bun test __tests__/install.test.ts
const script = resolve(import.meta.dir, "../install.sh");
const mock = join(import.meta.dir, "fixtures/bootstrap-command.ts");
const repoUrl = "https://github.com/dot-luna/luna-next.git";
const bash = Bun.which("bash")!;
const realGit = Bun.which("git")!;
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

interface Command {
  name: string;
  args: string[];
  cwd: string;
  repo?: string;
}

function spawn(cmd: string[], env: Record<string, string>, cwd: string, input?: Buffer) {
  const child = Bun.spawnSync(cmd, { env, cwd, stdin: input ?? "ignore", stdout: "pipe", stderr: "pipe", timeout: 10_000 });
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}

class Fixture {
  // Spaces and quotes exercise argument forwarding and the printed resume command.
  root = mkdtempSync(join(tmpdir(), "luna bootstrap ' "));
  home = join(this.root, "home");
  work = join(this.root, "work");
  bin = join(this.root, "bin");
  log = join(this.root, "commands.jsonl");
  managed = join(this.home, ".local/src/luna-next");
  binary = join(this.home, ".local/bin/luna");
  env: Record<string, string> = {
    HOME: this.home, PATH: this.bin, LC_ALL: "C",
    BOOTSTRAP_BIN: this.bin, BOOTSTRAP_LOG: this.log,
    BOOTSTRAP_ONCE_MARKER: join(this.root, "once"),
    BOOTSTRAP_LUNA_WRAPPER: join(this.bin, "luna-wrapper"),
    // An inherited checkout must not change the installer's destination.
    LUNA_NEXT_ROOT: this.work,
  };

  constructor() {
    for (const path of [this.home, this.work, this.bin]) mkdirSync(path);
    // Restricted PATH permits only harmless real utilities; all package/network
    // commands use Bun fixtures, so the test cannot install or download anything.
    for (const name of ["bash", "cat", "mkdir", "mktemp", "rm", "install", "mv", "realpath"]) {
      symlinkSync(Bun.which(name)!, join(this.bin, name));
    }
    for (const name of ["sudo", "pacman", "git", "mise", "makepkg", "bun", "sleep"]) this.wrapper(name);
    this.wrapper("luna", this.env.BOOTSTRAP_LUNA_WRAPPER);
  }

  wrapper(name: string, path = join(this.bin, name)) {
    const command = [process.execPath, mock, name].map(shellQuote).join(" ");
    writeFileSync(path, `#!${bash}\nexec ${command} "$@"\n`, { mode: 0o755 });
  }

  run(args: string[] = [], { success = true, piped = false } = {}) {
    const result = piped
      ? spawn([bash, "-s", "--", ...args], this.env, this.work, readFileSync(script))
      : spawn([script, ...args], this.env, this.work);
    expect(result.exitCode === 0, result.stdout + result.stderr).toBe(success);
    return result;
  }

  commands(name?: string): Command[] {
    const commands: Command[] = existsSync(this.log)
      ? readFileSync(this.log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    return commands.filter(item => name === undefined || item.name === name);
  }

  checkout(state: Record<string, unknown> = {}) {
    mkdirSync(join(this.managed, ".git"), { recursive: true });
    mkdirSync(join(this.managed, "src/luna-cli"), { recursive: true });
    this.env.BOOTSTRAP_GIT = JSON.stringify(state);
  }

  previousBinary() {
    mkdirSync(dirname(this.binary), { recursive: true });
    writeFileSync(this.binary, "previous executable");
  }

  clearLog() { rmSync(this.log, { force: true }); }
  staging() { return readdirSync(dirname(this.managed)).filter(name => name.startsWith(".luna-clone.")); }
}

// The installer deliberately rejects root; ordinary users exercise every path.
const userTests = process.getuid?.() === 0 ? describe.skip : describe;
userTests("root installer", () => {
  let value: Fixture;
  beforeEach(() => { value = new Fixture(); });
  afterEach(() => { rmSync(value.root, { recursive: true, force: true }); });

  test("prepares sources, builds API then CLI, and hands off with default flags", () => {
    const result = value.run();
    expect(value.commands("pacman")[0]!.args).toEqual([
      "-Syu", "--needed", "--noconfirm", "--", "base-devel", "ca-certificates", "curl", "git", "mise", "sudo",
    ]);
    expect(value.commands("makepkg")[0]!.args).toEqual(["--syncdeps", "--install", "--needed", "--noconfirm"]);
    expect(value.commands("mise")[0]!.args).toEqual(["--cd", value.home, "use", "--global", "--yes", "bun@latest"]);
    const clone = value.commands("git").at(-1)!.args;
    expect(clone.slice(0, -1)).toEqual(["clone", "--branch", "master", "--single-branch", "--", repoUrl]);
    expect(dirname(clone.at(-1)!)).toBe(dirname(value.managed));
    expect(existsSync(clone.at(-1)!)).toBe(false);
    expect(existsSync(join(value.managed, ".git"))).toBe(true);
    expect(value.commands("bun").map(item => item.args)).toEqual([
      ["install", "--frozen-lockfile"],
      ["run", "--cwd", "packages/luna-api", "build"],
      ["run", "--cwd", "src/luna-cli", "build"],
    ]);
    expect(value.commands("sleep")[0]!.args).toEqual(["5"]);
    expect(value.commands("luna")[0]).toMatchObject({ args: ["self", "install"], repo: value.managed });
    expect(existsSync(value.binary)).toBe(true);
    expect(result.stdout + result.stderr).not.toContain("routine output");
    expect(result.stdout).toContain("self install called");
    expect(readdirSync(dirname(value.binary)).filter(name => name.startsWith(".luna."))).toEqual([]);
  });

  test("accepts a relative checkout and piped input, preserving the original flags", () => {
    value.run(["--install-dir=custom checkout"], { piped: true });
    expect(value.commands("luna")[0]).toMatchObject({
      args: ["self", "install", "--install-dir=custom checkout"], repo: join(value.work, "custom checkout"),
    });
  });

  test("reuses an existing yay installation", () => {
    value.wrapper("yay");
    value.run();
    expect(value.commands("makepkg")).toEqual([]);
  });

  test("only fast-forwards clean existing checkouts", () => {
    value.checkout();
    value.run();
    const commands = value.commands("git");
    expect(commands.find(item => item.args.includes("fetch"))!.args.slice(-4)).toEqual([
      "fetch", "--no-tags", "origin", "+refs/heads/master:refs/remotes/origin/master",
    ]);
    expect(commands.at(-1)!.args.slice(-7)).toEqual([
      "pull", "--ff-only", "--no-rebase", "--no-autostash", "--no-tags", "origin", "refs/heads/master",
    ]);
    expect(commands.findIndex(item => item.args.includes("switch"))).toBeLessThan(commands.findIndex(item => item.args.includes("pull")));
    expect(commands.some(item => item.args.includes("clone") && item.args.includes(repoUrl))).toBe(false);
  });

  test("rejects unrelated origins and tracked or untracked edits", () => {
    value.checkout();
    for (const state of [{ origin: "https://example.com/other.git" }, { changes: " M file" }, { changes: "?? personal" }]) {
      value.clearLog();
      value.env.BOOTSTRAP_GIT = JSON.stringify(state);
      const result = value.run([], { success: false });
      if ("changes" in state) expect(result.stderr).toContain(`There are local changes in ${value.managed}`);
      expect(value.commands("git").some(item => item.args.includes("switch") || item.args.includes("pull"))).toBe(false);
      expect(value.commands("bun")).toEqual([]);
      expect(value.commands("luna")).toEqual([]);
    }
  });

  test("resolves directory links and parent path components", () => {
    symlinkSync(value.work, join(value.home, "linked"));
    for (const [destination, selected] of [
      [join(value.home, "linked/repo"), join(value.work, "repo")],
      [value.home + "/../repo", join(value.root, "repo")],
    ]) {
      value.clearLog();
      value.run(["--install-dir", destination!]);
      expect(value.commands("luna")[0]).toMatchObject({ repo: selected, args: ["self", "install", "--install-dir", destination] });
    }
  });

  test("uses an existing empty checkout directory", () => {
    mkdirSync(value.managed, { recursive: true });
    value.run();
    expect(existsSync(join(value.managed, ".git"))).toBe(true);
  });

  test("creates a missing home and nested directories", () => {
    rmdirSync(value.home);
    value.run();
    expect(existsSync(value.binary)).toBe(true);
    expect(existsSync(join(value.managed, "src/luna-cli"))).toBe(true);
  });

  test("falls back from an invalid TMPDIR and removes temporary downloads", () => {
    value.env.TMPDIR = join(value.root, "missing/tmp");
    value.run();
    expect(existsSync(value.binary)).toBe(true);
    const clone = value.commands("git").find(item => item.args.includes("https://aur.archlinux.org/yay.git"))!;
    expect(existsSync(dirname(clone.args.at(-1)!))).toBe(false);
  });

  test("keeps contents of a nonempty checkout directory", () => {
    mkdirSync(value.managed, { recursive: true });
    const personal = join(value.managed, ".personal");
    writeFileSync(personal, "keep me");
    value.run([], { success: false });
    expect(readFileSync(personal, "utf8")).toBe("keep me");
    expect(value.commands("bun")).toEqual([]);
  });

  test("does not replace files blocking directory creation", () => {
    const destination = join(value.work, "personal");
    writeFileSync(destination, "keep me");
    value.run(["--install-dir", join(destination, "checkout")], { success: false });
    expect(readFileSync(destination, "utf8")).toBe("keep me");
    expect(value.commands("sudo")).toEqual([]);
  });

  test("cleans staging after exhausted clone retries and leaves the destination empty", () => {
    value.wrapper("yay");
    value.env.BOOTSTRAP_GIT_FAIL = "clone";
    value.run([], { success: false });
    expect(readdirSync(value.managed)).toEqual([]);
    expect(value.staging()).toEqual([]);
    expect(value.commands("git").filter(item => item.args.includes("clone"))).toHaveLength(3);
  });

  test("retries temporary Git and Bun downloads without mixing failed output", () => {
    value.wrapper("yay");
    for (const operation of ["git:ls-remote", "git:clone", "mise:use"]) {
      value.clearLog();
      rmSync(value.env.BOOTSTRAP_ONCE_MARKER!, { force: true });
      value.env.BOOTSTRAP_FAIL_ONCE = operation;
      const result = value.run(["--install-dir=" + join(value.work, operation)]);
      expect(value.commands("luna")).toHaveLength(1);
      expect(result.stdout + result.stderr).not.toContain("discard this failed attempt");
      const [name, action] = operation.split(":");
      expect(value.commands(name).filter(item => item.args.includes(action!)).length).toBeGreaterThanOrEqual(2);
    }
  });

  test("retries a temporary fetch failure", () => {
    value.checkout();
    value.env.BOOTSTRAP_FAIL_ONCE = "git:fetch";
    value.run();
    expect(value.commands("git").filter(item => item.args.includes("fetch"))).toHaveLength(2);
  });

  test("preserves files added to the destination during a clone", () => {
    value.env.BOOTSTRAP_RACE_DEST = value.managed;
    value.run([], { success: false });
    expect(readFileSync(join(value.managed, ".personal"), "utf8")).toBe("keep me");
    expect(existsSync(join(value.managed, ".git"))).toBe(false);
    expect(value.staging()).toEqual([]);
  });

  test("rejects bad flags before changing the system", () => {
    for (const args of [["--repo", value.work], ["--install-dir"], ["--install-dir="], ["--ref"], ["--ref="], ["--help"], ["--unexpected"]]) {
      value.run(args, { success: false });
    }
    expect(value.commands()).toEqual([]);
  });

  test("resolves latest from the remote default branch without changing forwarded flags", () => {
    value.env.BOOTSTRAP_GIT = JSON.stringify({ default: "main" });
    value.run(["--ref=latest"]);
    expect(value.commands("git").at(-1)!.args).toContain("main");
    expect(value.commands("luna")[0]!.args).toEqual(["self", "install", "--ref=latest"]);
  });

  test("clones explicit branches and tags without looking up the default branch", () => {
    for (const ref of ["feature/new-cli", "v1.2.3"]) {
      value.clearLog();
      const args = ["--install-dir", join(value.work, ref), "--ref=" + ref];
      value.run(args);
      expect(value.commands("git").at(-1)!.args).toContain(ref);
      expect(value.commands("git").some(item => item.args.includes("--symref"))).toBe(false);
      expect(value.commands("luna")[0]!.args).toEqual(["self", "install", ...args]);
    }
  });

  test("switches an existing checkout to the requested remote branch", () => {
    value.checkout({ refs: { "feature/cli": "heads" } });
    value.run(["--ref", "feature/cli"]);
    expect(value.commands("git").find(item => item.args.includes("switch"))!.args.slice(-4)).toEqual([
      "--no-track", "-c", "feature/cli", "refs/remotes/origin/feature/cli",
    ]);
  });

  test("uses detached HEAD for tags", () => {
    value.checkout({ refs: { "v1.2.3": "tags" } });
    value.run(["--ref=v1.2.3"]);
    expect(value.commands("git").at(-1)!.args.slice(-4)).toEqual([
      "switch", "--no-overwrite-ignore", "--detach", "FETCH_HEAD",
    ]);
  });

  for (const mode of ["detached tag", "attached tag", "moved remote branch", "branch update"]) {
    test(`preserves personal work with a ${mode}`, () => {
      const remote = join(value.root, "remote");
      const git = (args: string[]) => {
        const result = spawn([realGit, ...args], value.env, value.work);
        expect(result.exitCode, result.stderr).toBe(0);
        return result.stdout.trim();
      };
      mkdirSync(remote);
      git(["init", "--initial-branch=master", remote]);
      git(["-C", remote, "config", "user.name", "Bootstrap Test"]);
      git(["-C", remote, "config", "user.email", "bootstrap@example.invalid"]);
      writeFileSync(join(remote, "source"), "remote content");
      git(["-C", remote, "add", "source"]);
      git(["-C", remote, "commit", "-m", "remote source"]);
      git(["-C", remote, "tag", "v1"]);
      let selected = git(["-C", remote, "rev-parse", "HEAD"]);
      mkdirSync(dirname(value.managed), { recursive: true });
      git(["clone", remote, value.managed]);
      git(["-C", value.managed, "config", "user.name", "Bootstrap Test"]);
      git(["-C", value.managed, "config", "user.email", "bootstrap@example.invalid"]);
      git(["-C", value.managed, "switch", "--detach"]);
      writeFileSync(join(value.managed, "personal"), "personal content");
      git(["-C", value.managed, "add", "personal"]);
      git(["-C", value.managed, "commit", "-m", "personal work"]);
      const personal = git(["-C", value.managed, "rev-parse", "HEAD"]);
      if (mode === "moved remote branch") {
        git(["-C", value.managed, "update-ref", "refs/remotes/origin/master", personal]);
      } else {
        git(["-C", value.managed, "tag", "--force", "v1"]);
      }
      if (mode === "attached tag") git(["-C", value.managed, "switch", "master"]);
      if (mode === "branch update") {
        writeFileSync(join(remote, "source"), "updated remote content");
        git(["-C", remote, "commit", "-am", "update remote source"]);
        selected = git(["-C", remote, "rev-parse", "HEAD"]);
      }
      git(["-C", value.managed, "remote", "set-url", "origin", repoUrl]);
      value.wrapper("yay");
      value.env.BOOTSTRAP_REAL_GIT = realGit;
      value.env.BOOTSTRAP_REAL_REMOTE = pathToFileURL(remote).href;
      value.env.GIT_ALLOW_PROTOCOL = "file";
      if (mode === "moved remote branch") {
        const result = value.run(["--ref=master"], { success: false });
        expect(result.stderr).toContain("unreferenced detached commit");
        expect(git(["-C", value.managed, "rev-parse", "HEAD"])).toBe(personal);
        return;
      }
      value.run([mode === "branch update" ? "--ref=master" : "--ref=v1"]);
      expect(git(["-C", value.managed, "rev-parse", "HEAD"])).toBe(selected);
      expect(git(["-C", value.managed, "rev-parse", "refs/tags/v1"])).toBe(personal);
      expect(git(["-C", value.managed, "for-each-ref", "--contains", personal, "--format=%(refname)"])).toContain("refs/tags/v1");
      if (mode === "branch update") expect(readFileSync(join(value.managed, "source"), "utf8")).toBe("updated remote content");
    });
  }

  test("prefers branches over identically named tags", () => {
    value.checkout({ refs: { stable: "both" } });
    value.run(["--ref=stable"]);
    expect(value.commands("git").at(-1)!.args).toContain("refs/heads/stable");
  });

  test("preserves an unreferenced detached commit", () => {
    value.checkout({ detached: true, head: "b".repeat(40) });
    const result = value.run([], { success: false });
    expect(result.stderr).toContain("unreferenced detached commit");
    expect(value.commands("git").some(item => item.args.includes("switch"))).toBe(false);
  });

  test("stops before building when the ref or remote default is missing", () => {
    value.checkout({ refs: {} });
    value.run(["--ref=missing"], { success: false });
    expect(value.commands("bun")).toEqual([]);
    value.env.BOOTSTRAP_GIT = JSON.stringify({ missing_default: true });
    value.run([], { success: false });
    expect(value.commands("bun")).toEqual([]);
  });

  test("rejects malformed refs before system changes", () => {
    for (const ref of ["../bad", "-bad", "branch..name", "bad name", "x.lock", "x@{1}"]) {
      value.run(["--ref=" + ref], { success: false });
      expect(value.commands()).toEqual([]);
    }
  });

  test("stops before building after failed checkout inspection, fetch, or pull", () => {
    value.checkout();
    for (const command of ["status", "fetch", "pull"]) {
      value.clearLog();
      value.env.BOOTSTRAP_GIT_FAIL = command;
      value.run([], { success: false });
      expect(value.commands("bun")).toEqual([]);
    }
  });

  test("shows package failure diagnostics and stops", () => {
    value.env.BOOTSTRAP_FAIL = "pacman";
    const result = value.run([], { success: false });
    expect(result.exitCode).toBe(17);
    expect(result.stderr).toContain("simulated failure diagnostics");
    expect(value.commands("git")).toEqual([]);
  });

  test("preserves the installed executable after a failed build", () => {
    value.previousBinary();
    value.env.BOOTSTRAP_FAIL = "bun";
    value.run([], { success: false });
    expect(readFileSync(value.binary, "utf8")).toBe("previous executable");
    expect(value.commands("luna")).toEqual([]);
  });

  test("CLI build failures prevent publication and preserve the installed binary", () => {
    value.previousBinary();
    value.env.BOOTSTRAP_BUILD_FAIL = "src/luna-cli";
    const result = value.run([], { success: false });
    expect(result.exitCode).toBe(17);
    expect(readFileSync(value.binary, "utf8")).toBe("previous executable");
    expect(value.commands("luna")).toEqual([]);
  });

  test("API build failures stop before compiling the CLI and preserve the installed binary", () => {
    value.previousBinary();
    value.env.BOOTSTRAP_BUILD_FAIL = "packages/luna-api";
    const result = value.run([], { success: false });
    expect(result.exitCode).toBe(17);
    expect(readFileSync(value.binary, "utf8")).toBe("previous executable");
    expect(value.commands("bun").some(item => item.args.includes("src/luna-cli"))).toBe(false);
    expect(value.commands("luna")).toEqual([]);
  });

  test("propagates a CLI setup failure", () => {
    value.env.BOOTSTRAP_FAIL = "luna";
    const result = value.run([], { success: false });
    expect(result.exitCode).toBe(17);
    expect(result.stderr).toContain("simulated failure diagnostics");
  });

  test("an interrupt during the pause prints an executable, correctly quoted resume command", () => {
    value.env.BOOTSTRAP_CANCEL = "2";
    const args = ["--install-dir=" + join(value.work, "manual ' checkout"), "--ref=feature/new-cli"];
    const result = value.run(args, { success: false, piped: true });
    expect(result.exitCode).toBe(130);
    expect(result.stdout).toContain("Other settings are not configured");
    expect(value.commands("luna")).toEqual([]);
    const recovery = result.stdout.split("To finish, run:\n")[1]!.trim();
    const resumed = spawn([bash, "-c", recovery], value.env, value.work);
    expect(resumed.exitCode, resumed.stderr).toBe(0);
    expect(value.commands("luna")[0]!.args).toEqual(["self", "install", ...args]);
  });

  test("termination during the pause skips setup and prints the resume command", () => {
    value.env.BOOTSTRAP_CANCEL = "15";
    const result = value.run([], { success: false });
    expect(result.exitCode).toBe(143);
    expect(result.stdout).toContain("To finish, run:");
    expect(value.commands("luna")).toEqual([]);
  });
});
