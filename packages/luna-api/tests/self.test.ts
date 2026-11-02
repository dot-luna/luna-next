import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Luna } from "../src/index.ts";
import { SelfFixture } from "./fixtures/self-fixture.ts";

const userTests = process.getuid?.() === 0 ? describe.skip : describe;
userTests("self operations", () => {
  let value: SelfFixture;
  beforeEach(() => {
    value = new SelfFixture();
  });
  afterEach(() => {
    value.dispose();
  });
  const identity = { name: "Test User", email: "test@example.test" };

  test("direct installation updates, installs before dependencies, publishes CLI, configures Git, then installs after dependencies", async () => {
    const progress: string[] = [];
    const oldCwd = process.cwd();
    const oldRoot = Bun.env.LUNA_ROOT;
    const response = await Luna.self.install({
      env: value.env,
      git: identity,
      onProgress: (message) => progress.push(message),
    });
    expect(response).toEqual({
      succes: true,
      data: {
        repository: value.repository,
        executable: value.executable,
        cliRebuilt: true,
        completed: true,
        failed: [],
        logDirectory: expect.any(String),
        installedApps: [],
        installedWebapps: [],
        pending: [],
      },
    });
    const commands = value.commands();
    const index = (name: string, arg: string) =>
      commands.findIndex((item) => item.name === name && item.args.includes(arg));
    expect(index("git", "pull")).toBeLessThan(index("pacman", "neovim"));
    expect(index("pacman", "-Syu")).toBeLessThan(index("pacman", "neovim"));
    expect(index("pacman", "neovim")).toBeLessThan(index("bun", "build"));
    expect(index("bun", "build")).toBeLessThan(index("git", "user.name"));
    expect(index("git", "user.name")).toBeLessThan(index("pacman", "gcc"));
    expect(index("pacman", "gcc")).toBeLessThan(index("mise", "node@lts"));
    expect(index("mise", "node@lts")).toBeLessThan(index("pacman", "zed"));
    expect(
      commands
        .filter((item) => item.name !== "gsettings")
        .every((item) => item.cwd === value.repository && item.repository === value.repository),
    ).toBe(true);
    expect(value.git(value.repository, ["config", "--global", "user.name"])).toBe(identity.name);
    expect(value.git(value.repository, ["config", "--global", "init.defaultBranch"])).toBe(
      "master",
    );
    expect(value.git(value.repository, ["config", "--global", "core.editor"])).toBe("nvim");
    expect(readFileSync(value.executable, "utf8")).toContain("fixture CLI");
    expect(statSync(value.executable).mode & 0o777).toBe(0o755);
    expect(progress).toHaveLength(11);
    expect(process.cwd()).toBe(oldCwd);
    expect(Bun.env.LUNA_ROOT).toBe(oldRoot);
  });

  test("bootstrap skips checkout mutations, upgrade and build while still installing both package stages", async () => {
    const result = await Luna.self.install({ env: value.env, fromBootstrap: true, git: identity });
    expect(result).toMatchObject({ succes: true, data: { cliRebuilt: false } });
    const commands = value.commands();
    expect(commands.filter((item) => item.name === "bun")).toEqual([]);
    expect(
      commands.some((item) =>
        item.args.some((arg) => ["pull", "fetch", "switch", "-Syu"].includes(arg)),
      ),
    ).toBe(false);
    expect(
      commands.filter((item) => item.name === "pacman").map((item) => item.args.at(-1)),
    ).toEqual(["neovim", "gcc", "zed"]);
    expect(readFileSync(value.executable, "utf8")).toBe("previous CLI");
  });

  test("keeps existing Git identity and unrelated settings and requests only missing values", async () => {
    value.git(value.repository, ["config", "--global", "user.name", "Existing Name"]);
    value.git(value.repository, ["config", "--global", "credential.helper", "fixture-helper"]);
    const requests: unknown[] = [];
    const result = await Luna.self.install({
      env: value.env,
      fromBootstrap: true,
      requestGitIdentity: async (current) => {
        requests.push(current);
        return { name: current.name!, email: identity.email };
      },
    });
    expect(result.succes).toBe(true);
    expect(requests).toEqual([{ name: "Existing Name", email: undefined }]);
    const again = await Luna.self.install({
      env: value.env,
      fromBootstrap: true,
      requestGitIdentity: async () => {
        throw new Error("must not prompt");
      },
    });
    expect(again.succes).toBe(true);
    expect(value.git(value.repository, ["config", "--global", "user.name"])).toBe("Existing Name");
    expect(value.git(value.repository, ["config", "--global", "credential.helper"])).toBe(
      "fixture-helper",
    );
  });

  test("missing identity stops before after-CLI packages without inventing identity values", async () => {
    const result = await Luna.self.install({ env: value.env, fromBootstrap: true });
    expect(result).toMatchObject({ succes: false, err: "INPUT_REQUIRED" });
    expect(
      value.commands().some((item) => item.name === "pacman" && item.args.includes("gcc")),
    ).toBe(false);
    expect(existsSync(join(value.home, ".gitconfig"))).toBe(false);
  });

  test("requests only a missing Git name when global email already exists", async () => {
    value.git(value.repository, ["config", "--global", "user.email", "existing@example.test"]);
    const requests: unknown[] = [];
    const result = await Luna.self.install({
      env: value.env,
      fromBootstrap: true,
      requestGitIdentity: async (current) => {
        requests.push(current);
        return { name: "Missing Name", email: current.email! };
      },
    });
    expect(result.succes).toBe(true);
    expect(requests).toEqual([{ name: undefined, email: "existing@example.test" }]);
    expect(value.git(value.repository, ["config", "--global", "user.email"])).toBe(
      "existing@example.test",
    );
  });

  test.each(["include.path", "includeIf"])(
    "keeps identity in %s without prompts or top-level overrides",
    async (include) => {
      const included = join(value.home, "identity.gitconfig");
      const contents = "[user]\n\tname = Included User\n\temail = included@example.test\n";
      value.write(value.home, "identity.gitconfig", contents);
      const key =
        include === "include.path" ? include : `includeIf.gitdir:${value.repository}/.git.path`;
      value.git(value.repository, ["config", "--global", key, included]);
      const result = await Luna.self.install({
        env: value.env,
        fromBootstrap: true,
        requestGitIdentity: async () => {
          throw new Error("Included identity must not prompt");
        },
      });
      expect(result.succes).toBe(true);
      expect(readFileSync(included, "utf8")).toBe(contents);
      expect(readFileSync(join(value.home, ".gitconfig"), "utf8")).not.toContain("[user]");
      expect(value.git(value.repository, ["config", "--global", "--includes", "user.name"])).toBe(
        "Included User",
      );
      expect(value.git(value.repository, ["config", "--global", "--includes", "user.email"])).toBe(
        "included@example.test",
      );

      const overridden = await Luna.self.install({
        env: value.env,
        fromBootstrap: true,
        git: { name: "Explicit User" },
      });
      expect(overridden.succes).toBe(true);
      expect(value.git(value.repository, ["config", "--global", "--get", "user.name"])).toBe(
        "Explicit User",
      );
      expect(value.git(value.repository, ["config", "--global", "--includes", "user.email"])).toBe(
        "included@example.test",
      );
      expect(readFileSync(included, "utf8")).toBe(contents);
    },
  );

  test("invalid lists, refs, and foreign origins fail before sudo or package writes", async () => {
    value.write(value.repository, "installs/packages.mise.jsonc", "{broken");
    expect(await Luna.self.install({ env: value.env, fromBootstrap: true })).toMatchObject({
      succes: false,
      err: "INVALID_METADATA",
    });
    expect(await Luna.self.install({ env: value.env, ref: "--bad" })).toMatchObject({
      succes: false,
      err: "INVALID_ARGUMENT",
    });
    value.git(value.repository, [
      "remote",
      "set-url",
      "origin",
      "https://example.test/unrelated.git",
    ]);
    expect(await Luna.self.install({ env: value.env })).toMatchObject({
      succes: false,
      err: "INVALID_PATH",
    });
    expect(value.commands().some((item) => item.name === "sudo")).toBe(false);
  });

  test.each(["{broken", '{"application/pdf":false}'])(
    "invalid defaults %s stop before checkout updates or installation writes",
    async (source) => {
      value.write(value.repository, "installs/defaults.jsonc", source);
      expect(await Luna.self.install({ env: value.env, git: identity })).toMatchObject({
        succes: false,
        err: "INVALID_METADATA",
      });
      expect(
        value
          .commands()
          .some(
            (item) =>
              ["sudo", "pacman", "xdg-mime"].includes(item.name) ||
              item.args.some((arg) => ["fetch", "pull"].includes(arg)),
          ),
      ).toBe(false);
      expect(existsSync(join(value.home, ".config/mimeapps.list"))).toBe(false);
    },
  );

  test("updated default manifests are validated before installing packages", async () => {
    value.write(value.upstream, "installs/defaults.jsonc", '{"application/pdf":false}');
    value.commit("Invalid upstream defaults");
    expect(await Luna.self.install({ env: value.env, git: identity })).toMatchObject({
      succes: false,
      err: "INVALID_METADATA",
    });
    expect(value.commands().some((item) => item.name === "git" && item.args.includes("pull"))).toBe(
      true,
    );
    expect(value.commands().some((item) => ["sudo", "pacman"].includes(item.name))).toBe(false);
  });

  test("defaults resolve applications installed in the later package stage", async () => {
    value.env.SELF_INSTALLED_JSON = join(value.root, "installed.json");
    value.env.LUNA_TEST_DESKTOP_PACKAGE = "zed";
    const source = '{"application/pdf":"fixture-viewer.desktop"}';
    value.write(value.repository, "installs/defaults.jsonc", source);
    expect(
      await Luna.self.install({ env: value.env, fromBootstrap: true, git: identity }),
    ).toMatchObject({ succes: true, data: { completed: true, failed: [] } });
    expect(readFileSync(join(value.home, ".config/mimeapps.list"), "utf8")).toContain(
      "application/pdf=fixture-viewer.desktop;",
    );
    expect(readFileSync(join(value.repository, "installs/defaults.jsonc"), "utf8")).toBe(source);
  });

  for (const skipFailed of [false, true]) {
    test(`unavailable defaults do not report completion with skipFailed=${skipFailed}`, async () => {
      value.write(
        value.repository,
        "installs/defaults.jsonc",
        '{"application/pdf":"missing-viewer.desktop"}',
      );
      const response = await Luna.self.install({
        env: value.env,
        fromBootstrap: true,
        git: identity,
        skipFailed,
      });
      if (skipFailed) {
        expect(response).toMatchObject({
          succes: true,
          data: {
            completed: false,
            failed: [
              { app: "defaults", retry: expect.stringContaining("defaults reset --install-dir") },
            ],
          },
        });
      } else {
        expect(response).toMatchObject({
          succes: false,
          errMessage: expect.stringContaining("defaults reset --install-dir"),
        });
      }
      expect(
        value.commands().some((item) => item.name === "pacman" && item.args.includes("zed")),
      ).toBe(true);
      expect(existsSync(join(value.home, ".config/mimeapps.list"))).toBe(false);
    });
  }

  test("build failures preserve the installed CLI and prevent Git and after-CLI setup", async () => {
    const result = await Luna.self.install({
      env: { ...value.env, SELF_FAIL: "bun:run" },
      git: identity,
    });
    expect(result).toMatchObject({
      succes: false,
      err: "COMMAND_FAILED",
      errMessage: expect.stringContaining("fixture failure diagnostics"),
    });
    expect(readFileSync(value.executable, "utf8")).toBe("previous CLI");
    expect(
      value.commands().some((item) => item.name === "git" && item.args.includes("config")),
    ).toBe(false);
    expect(
      value.commands().some((item) => item.name === "pacman" && item.args.includes("gcc")),
    ).toBe(false);
    expect(readdirSync(dirname(value.executable))).toEqual(["luna"]);
  });

  test("package failures prevent later stages", async () => {
    expect(
      await Luna.self.install({
        env: { ...value.env, SELF_FAIL: "pacman:-S" },
        fromBootstrap: true,
        git: identity,
      }),
    ).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
    expect(
      value.commands().some((item) => item.name === "git" && item.args.includes("config")),
    ).toBe(false);
    expect(value.commands().some((item) => item.name === "mise")).toBe(false);
  });

  test("update follows latest and publishes the CLI without package installation or Git configuration", async () => {
    value.write(value.upstream, "version.txt", "new version");
    value.commit("New upstream version");
    expect(await Luna.self.update({ env: value.env })).toEqual({
      succes: true,
      data: { repository: value.repository, executable: value.executable },
    });
    expect(readFileSync(join(value.repository, "version.txt"), "utf8")).toBe("new version");
    expect(value.commands().some((item) => ["sudo", "pacman"].includes(item.name))).toBe(false);
    expect(
      value.commands().some((item) => item.name === "git" && item.args.includes("config")),
    ).toBe(false);
  });

  test("branch wins over an identically named tag; tags select detached HEAD without replacing local tags", async () => {
    const initial = value.git(value.upstream, ["rev-parse", "HEAD"]);
    value.git(value.upstream, ["tag", "selected"]);
    value.git(value.upstream, ["switch", "-c", "selected"]);
    value.write(value.upstream, "branch.txt", "selected branch");
    value.commit("Branch version");
    expect((await Luna.self.update({ env: value.env, ref: "selected" })).succes).toBe(true);
    expect(value.git(value.repository, ["branch", "--show-current"])).toBe("selected");
    value.git(value.upstream, ["tag", "release"]);
    value.git(value.repository, ["tag", "release", initial]);
    expect((await Luna.self.update({ env: value.env, ref: "release" })).succes).toBe(true);
    expect(value.git(value.repository, ["branch", "--show-current"])).toBe("");
    expect(value.git(value.repository, ["rev-parse", "refs/tags/release"])).toBe(initial);
  });

  test("update rejects dirty checkouts and does not publish a new executable", async () => {
    value.write(value.repository, "untracked.txt", "personal changes");
    expect(await Luna.self.update({ env: value.env })).toMatchObject({
      succes: false,
      err: "INVALID_PATH",
    });
    expect(value.commands().some((item) => item.name === "bun")).toBe(false);
    expect(readFileSync(value.executable, "utf8")).toBe("previous CLI");
  });

  test("update refuses diverged branches and unreferenced detached commits", async () => {
    value.write(value.repository, "personal.txt", "personal commit");
    value.commit("Personal commit", value.repository);
    value.write(value.upstream, "remote.txt", "remote commit");
    value.commit("Remote commit");
    const personal = value.git(value.repository, ["rev-parse", "HEAD"]);
    expect(await Luna.self.update({ env: value.env })).toMatchObject({
      succes: false,
      err: "COMMAND_FAILED",
    });
    expect(value.git(value.repository, ["rev-parse", "HEAD"])).toBe(personal);
    value.git(value.repository, ["switch", "--detach"]);
    value.write(value.repository, "detached.txt", "detached commit");
    value.commit("Detached commit", value.repository);
    const detached = value.git(value.repository, ["rev-parse", "HEAD"]);
    expect(await Luna.self.update({ env: value.env })).toMatchObject({
      succes: false,
      err: "INVALID_PATH",
    });
    expect(value.git(value.repository, ["rev-parse", "HEAD"])).toBe(detached);
    expect(readFileSync(value.executable, "utf8")).toBe("previous CLI");
  });

  test("update requires mise before mutating the checkout", async () => {
    rmSync(join(value.bin, "mise"));
    expect(await Luna.self.update({ env: value.env })).toMatchObject({
      succes: false,
      err: "INVALID_ENVIRONMENT",
    });
    expect(value.commands().some((item) => item.args.includes("fetch"))).toBe(false);
  });

  test("missing HOME is a path error before any external command", async () => {
    expect(await Luna.self.install({ env: { PATH: value.bin } })).toMatchObject({
      succes: false,
      err: "INVALID_PATH",
    });
    expect(value.commands()).toEqual([]);
  });
});
