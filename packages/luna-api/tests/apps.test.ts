import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { Luna, type ApiResponse } from "../src/index.ts";
import { readCatalog } from "../src/apps/catalog.ts";
import { appContext } from "../src/apps/context.ts";
import { AppFixture } from "./fixtures/app-fixture.ts";

let f: AppFixture;
beforeEach(() => {
  f = new AppFixture();
});
afterEach(() => f.dispose());
function data<T>(r: ApiResponse<T>): T {
  if (!r.succes) throw new Error(r.errMessage);
  return r.data;
}
const stages = [
  "before_install",
  "before_build",
  "build",
  "after_build",
  "after_install",
  "before_configure",
  "after_configure",
];
const options = () => ({ env: f.env, repository: f.repository });

test("actual app catalog validates against all package ownership declarations", async () => {
  const repo = resolve(import.meta.dir, "../../..");
  expect(
    (
      await readCatalog(await appContext({ repository: repo, env: { ...f.env, LUNA_ROOT: repo } }))
    ).map((app) => app.id),
  ).toContain("chromium");
});

test("selected apps follow catalog order; dependencies and installation precede configuration", async () => {
  f.app(
    "first",
    {
      name: "first-package",
      source: "pacman",
      alias: ["one"],
      deps: [{ name: "plugin", source: "pacman" }],
    },
    stages.filter((stage) => !stage.includes("build")),
  );
  f.app("second", { name: "second-package", source: "local" }, stages);
  expect(data(await Luna.apps.install(["second", "first-package"], options())).installed).toEqual([
    "first",
    "second",
  ]);
  expect(f.hooks().map((h) => h.app + ":" + h.stage)).toEqual([
    "first:before_install",
    "first:after_install",
    "first:before_configure",
    "first:after_configure",
    ...stages.map((stage) => "second:" + stage),
  ]);
  const packages = f.commands().filter((c) => c.name === "pacman" && c.args[0] === "-S");
  expect(packages.map((c) => c.args.at(-1))).toEqual(["plugin", "first-package"]);
  const before = f.hooks().length;
  data(await Luna.apps.install([], options()));
  expect(
    f
      .hooks()
      .slice(before)
      .map((h) => h.stage),
  ).toEqual(["before_configure", "after_configure", "before_configure", "after_configure"]);
  data(await Luna.apps.install(["second"], { ...options(), force: true }));
  expect(
    f
      .hooks()
      .slice(-stages.length)
      .map((h) => h.stage),
  ).toEqual(stages);
});

test("configuration replaces declared exports, preserves exclusions and supports independent native includes", async () => {
  f.app("shell", {
    name: "shell",
    source: "local",
    exports: [
      { source: "config", target: "shell", exclude: ["secret"] },
      {
        source: "one.lua",
        target: "hypr/one.lua",
        user_config: {
          dest: ["$MISSING/path", "$LUNA_CONFIG_HOME_DIR/hypr/include.lua"],
          dest_mode: "include",
        },
      },
      {
        source: "two.lua",
        target: "hypr/two.lua",
        user_config: { dest: ["$LUNA_CONFIG_HOME_DIR/hypr/include.lua"], dest_mode: "include" },
      },
    ],
  });
  f.write(f.repository, "apps/shell/config/a", "new");
  f.write(f.repository, "apps/shell/config/secret", "private");
  f.write(f.repository, "apps/shell/one.lua", "one()");
  f.write(f.repository, "apps/shell/two.lua", "two()");
  f.write(f.home, ".config/luna/shell/stale", "old");
  f.write(f.home, ".config/luna/unrelated", "keep");
  f.write(f.home, ".config/luna/hypr/include.lua", "-- personal\n");
  data(await Luna.apps.configure([], options()));
  data(await Luna.apps.configure([], options()));
  expect(readdirSync(join(f.home, ".config/luna/shell"))).toEqual(["a"]);
  expect(readFileSync(join(f.home, ".config/luna/unrelated"), "utf8")).toBe("keep");
  const include = readFileSync(join(f.home, ".config/luna/hypr/include.lua"), "utf8");
  expect(include.match(/dofile\(/gu)).toHaveLength(2);
  expect(include).toContain("one.lua");
  expect(include).toContain("two.lua");
  expect(include).toContain("-- personal");
  expect(f.commands().some((c) => c.name === "pacman")).toBe(false);
});

test.each(["jsonc", "toml", "yaml"])(
  "native %s defaults merge without replacing user values",
  async (ext) => {
    const defaults =
      ext === "jsonc"
        ? '// defaults\n{"nested":{"one":1,"two":2},"keep":true}'
        : ext === "toml"
          ? "keep=true\n[nested]\none=1\ntwo=2\n"
          : "keep: true\nnested:\n  one: 1\n  two: 2\n";
    const user =
      ext === "jsonc"
        ? '{"nested":{"one":8},"extra":null}'
        : ext === "toml"
          ? 'extra="mine"\n[nested]\none=8\n'
          : "extra: null\nnested:\n  one: 8\n";
    f.app("settings", {
      name: "settings",
      source: "local",
      exports: [
        {
          source: `config.${ext}`,
          target: `settings/config.${ext}`,
          user_config: { dest: [`$HOME/personal.${ext}`], dest_mode: "merge" },
        },
      ],
    });
    f.write(f.repository, `apps/settings/config.${ext}`, defaults);
    f.write(f.home, `personal.${ext}`, user);
    data(await Luna.apps.configure([], options()));
    const text = readFileSync(join(f.home, `personal.${ext}`), "utf8");
    const decoded =
      ext === "toml"
        ? Bun.TOML.parse(text)
        : ext === "yaml"
          ? Bun.YAML.parse(text)
          : Bun.JSONC.parse(text);
    expect(decoded).toEqual({
      keep: true,
      nested: { one: 8, two: 2 },
      extra: ext === "toml" ? "mine" : null,
    });
  },
);

test("invalid catalogs and unsafe destinations stop before package writes", async () => {
  f.app("duplicate", { name: "gcc", source: "pacman" }, ["before_install"]);
  expect(await Luna.apps.install([], options())).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  expect(f.hooks()).toEqual([]);
  f.entries = [];
  f.app("safe", {
    name: "safe",
    source: "local",
    exports: [{ source: "file", target: "linked/file" }],
  });
  f.write(f.repository, "apps/safe/file", "new");
  mkdirSync(join(f.home, ".config/luna"), { recursive: true });
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  f.write(outside, "file", "keep");
  symlinkSync(outside, join(f.home, ".config/luna/linked"));
  expect(await Luna.apps.configure([], options())).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
  expect(readFileSync(join(outside, "file"), "utf8")).toBe("keep");
  expect(
    await Luna.apps.install([], {
      ...options(),
      env: { ...f.env, LUNA_GIT_APP_BUILD_DIR: join(f.home, ".local/share/luna/git/clone") },
    }),
  ).toMatchObject({ succes: false, err: "INVALID_PATH" });
  expect(f.commands().some((c) => c.name === "pacman")).toBe(false);
});

test("hook failure stops subsequent apps and does not report completion", async () => {
  f.app("first", { name: "first", source: "local" }, stages);
  f.app("second", { name: "second", source: "local" }, stages);
  expect(
    await Luna.apps.install([], { ...options(), env: { ...f.env, APP_FAIL: "first:build" } }),
  ).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  expect(f.hooks().map((h) => h.app)).not.toContain("second");
});

test("Git releases build from a disposable workspace, reruns skip build and force rebuilds", async () => {
  const remote = join(f.root, "git-source");
  mkdirSync(remote);
  f.git(remote, ["init", "--initial-branch=main"]);
  f.write(remote, "source.txt", "first");
  f.commit("First", remote);
  f.git(remote, ["tag", "v1.0.0"]);
  f.git(remote, ["tag", "v2.0.0-beta.1"]);
  f.app(
    "gitapp",
    {
      name: "gitapp",
      source: "git",
      url: remote,
      version: "latest",
      git_release_tag_pattern: "v*",
    },
    ["before_install", "build", "after_install", "before_configure"],
  );
  data(await Luna.apps.install([], options()));
  expect(f.hooks().find((h) => h.stage === "build")?.version).toBe("v1.0.0");
  const clone = join(f.home, ".local/share/luna/git/clone/gitapp");
  expect(f.git(clone, ["status", "--porcelain"])).toBe("");
  expect(existsSync(join(f.home, ".cache/luna/git/build/gitapp"))).toBe(false);
  const before = f.hooks().filter((h) => h.stage === "build").length;
  data(await Luna.apps.install([], options()));
  expect(f.hooks().filter((h) => h.stage === "build")).toHaveLength(before);
  data(await Luna.apps.install([], { ...options(), force: true }));
  expect(f.hooks().filter((h) => h.stage === "build")).toHaveLength(before + 1);
  f.write(clone, "personal", "keep");
  expect(await Luna.apps.install([], options())).toMatchObject({ succes: false, err: "CONFLICT" });
  expect(readFileSync(join(clone, "personal"), "utf8")).toBe("keep");
});

test("AUR selection validates provider order before running its hooks", async () => {
  unlinkSync(join(f.bin, "yay"));
  f.app("aur-app", { name: "aur-app", source: "aur" }, ["before_install"]);
  f.app("yay", { name: "yay", source: "local" }, ["build"]);
  expect(await Luna.apps.install(["aur-app"], options())).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  expect(f.hooks()).toEqual([]);
});

test("self install completes themes, ordered apps, later packages and web apps through shared APIs", async () => {
  f.browser();
  f.app("desktop", { name: "desktop", source: "local" }, [
    "before_install",
    "before_configure",
    "after_configure",
  ]);
  f.write(
    f.repository,
    "themes/bundled/tokyo-night/theme.jsonc",
    '{"packages":[{"name":"theme-font","source":"pacman"}]}',
  );
  f.write(
    f.repository,
    "installs/packages.webapp.jsonc",
    '[{"name":"Installed Web App","url":"https://example.test"}]',
  );
  const progress: string[] = [];
  const result = data(
    await Luna.self.install({
      ...options(),
      fromBootstrap: true,
      git: { name: "Test", email: "test@example.test" },
      onProgress: (message) => progress.push(message),
    }),
  );
  expect(result).toMatchObject({
    completed: true,
    pending: [],
    installedApps: ["desktop"],
    installedWebapps: ["Installed Web App"],
  });
  expect(data(await Luna.webapp.list({ env: f.env }))).toHaveLength(1);
  expect(JSON.parse(readFileSync(f.env.SELF_INSTALLED_JSON!, "utf8"))).toContain("theme-font");
  expect(JSON.parse(readFileSync(f.env.SELF_INSTALLED_JSON!, "utf8"))).toContain("zed");
  const index = (text: string) => progress.findIndex((line) => line.includes(text));
  expect(index("bundled themes")).toBeLessThan(index("Installing desktop"));
  expect(index("Configuring desktop")).toBeLessThan(index("later packages"));
  expect(index("later packages")).toBeLessThan(index("Installing web apps"));
});

test("self install validates web app catalog before sudo and does not mark failed app installation complete", async () => {
  f.write(
    f.repository,
    "installs/packages.webapp.jsonc",
    '[{"name":"Bad","url":"file:///etc/passwd"}]',
  );
  expect(await Luna.self.install({ ...options(), fromBootstrap: true })).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  expect(f.commands().some((c) => c.name === "sudo")).toBe(false);
  f.write(f.repository, "installs/packages.webapp.jsonc", "[]");
  f.app("broken", { name: "broken", source: "local" }, ["build"]);
  expect(
    await Luna.self.install({
      ...options(),
      fromBootstrap: true,
      git: { name: "Test", email: "test@example.test" },
      env: { ...f.env, APP_FAIL: "broken:build" },
    }),
  ).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  expect(f.commands().some((c) => c.name === "pacman" && c.args.includes("zed"))).toBe(false);
});

test("CLI install and configure command aliases preserve JSON responses", async () => {
  f.app("cli-app", { name: "cli-package", source: "pacman", alias: ["short"] });
  const entry = resolve(import.meta.dir, "../../../src/luna-cli/src/index.ts");
  for (const args of [
    ["install", "cli-app"],
    ["configure", "cli-app"],
    ["config", "cli-package"],
    ["confi", "cli-app"],
  ]) {
    const child = Bun.spawn([process.execPath, entry, ...args, "--json"], {
      env: f.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stdout + stderr).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      succes: true,
      data:
        args[0] === "install"
          ? { installed: ["cli-app"], failed: [], completed: true }
          : ["cli-app"],
    });
  }
  expect(f.commands().filter((c) => c.name === "pacman" && c.args[0] === "-S")).toHaveLength(1);
});

test("self install bootstraps the Yay provider before installing AUR theme fonts", async () => {
  unlinkSync(join(f.bin, "yay"));
  f.app("yay", { name: "yay", source: "local" }, ["build"]);
  f.write(
    f.repository,
    "apps/yay/hooks/build.ts",
    `#!${process.execPath}\nimport {copyFileSync,chmodSync} from "node:fs";\ncopyFileSync(process.env.SELF_BIN+"/pacman",process.env.SELF_BIN+"/yay");chmodSync(process.env.SELF_BIN+"/yay",0o755);\n`,
  );
  const { chmodSync } = await import("node:fs");
  chmodSync(join(f.repository, "apps/yay/hooks/build.ts"), 0o755);
  f.write(
    f.repository,
    "themes/bundled/tokyo-night/theme.jsonc",
    '{"packages":[{"name":"aur-font","source":"aur"}]}',
  );
  const progress: string[] = [];
  expect(
    await Luna.self.install({
      ...options(),
      fromBootstrap: true,
      git: { name: "Test", email: "test@example.test" },
      onProgress: (message) => progress.push(message),
    }),
  ).toMatchObject({ succes: true, data: { completed: true } });
  expect(progress).toContain("Installing yay for theme prerequisites...");
  expect(JSON.parse(readFileSync(f.env.SELF_INSTALLED_JSON!, "utf8"))).toContain("aur-font");
});

test("explicit mise versions require a matching installed version; partial requests resolve installed tools", async () => {
  f.app("tool", { name: "tool", source: "mise", version: "2.0.0" }, [
    "before_install",
    "after_install",
  ]);
  const env = { ...f.env, SELF_MISE_VERSIONS: '["1.0.0"]' };
  data(await Luna.apps.install([], { ...options(), env }));
  expect(
    f
      .commands()
      .some((c) => c.name === "mise" && c.args.includes("use") && c.args.includes("tool@2.0.0")),
  ).toBe(true);
  expect(f.hooks().map((h) => h.stage)).toEqual(["before_install", "after_install"]);
  f.entries = [];
  f.app("tool", { name: "tool", source: "mise", version: "1" }, [
    "before_install",
    "after_install",
  ]);
  const before = f.hooks().length;
  data(await Luna.apps.install([], { ...options(), env }));
  expect(f.hooks()).toHaveLength(before);
  expect(f.commands().some((c) => c.args.includes("tool@1"))).toBe(true);
});

test("self install does not bootstrap Yay for already installed theme fonts", async () => {
  unlinkSync(join(f.bin, "yay"));
  f.write(
    f.repository,
    "themes/bundled/tokyo-night/theme.jsonc",
    '{"packages":[{"name":"existing-font","source":"aur"}]}',
  );
  f.write(f.root, "installed.json", '["existing-font"]');
  const progress: string[] = [];
  data(
    await Luna.self.install({
      ...options(),
      fromBootstrap: true,
      git: { name: "Test", email: "test@example.test" },
      onProgress: (message) => progress.push(message),
    }),
  );
  expect(progress.some((message) => message.includes("Installing yay"))).toBe(false);
});
