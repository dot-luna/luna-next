import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { Luna, type ApiResponse } from "../src/index.ts";
import { AppFixture } from "./fixtures/app-fixture.ts";

let f: AppFixture;
beforeEach(() => {
  f = new AppFixture();
});
afterEach(() => f.dispose());
const options = () => ({ env: f.env, closeApps: false });
function data<T>(response: ApiResponse<T>): T {
  if (!response.succes) throw new Error(response.errMessage);
  return response.data;
}
function configuredApp(source = "pacman") {
  f.app("editor", {
    name: "editor",
    source,
    alias: ["ed"],
    exports: [
      {
        source: "config.jsonc",
        target: "editor/config.jsonc",
        user_config: { dest: ["$XDG_CONFIG_HOME/editor/config.jsonc"], dest_mode: "merge" },
      },
    ],
    cleanup: { purge: [["$XDG_DATA_HOME/editor"]] },
  });
  f.write(f.repository, "apps/editor/config.jsonc", '{"default":true}');
}

test("update selects only installed apps and refreshes packages/configuration in catalog order", async () => {
  f.app("first", { name: "first", source: "pacman" });
  f.app("missing", { name: "missing", source: "pacman" });
  f.app("last", { name: "last", source: "aur" });
  data(await Luna.apps.install(["last", "first"], options()));
  const before = f.commands().length;
  expect(data(await Luna.apps.update([], options())).updated).toEqual(["first", "last"]);
  const transactions = f
    .commands()
    .slice(before)
    .filter((call) => ["pacman", "yay"].includes(call.name) && call.args[0] === "-S");
  expect(transactions.map((call) => call.args.at(-1))).toEqual(["first", "last"]);
  expect(transactions.every((call) => !call.args.includes("-Syu"))).toBe(true);
  const missing = await Luna.apps.update(["missing"], options());
  expect(missing).toMatchObject({ succes: false, err: "INVALID_ARGUMENT" });
});

test("Git update skips unchanged builds, builds new revisions and honors force", async () => {
  f.app("gitapp", { name: "gitapp", source: "git", url: f.upstream }, ["build"]);
  data(await Luna.apps.install(["gitapp"], options()));
  const builds = () => f.hooks().filter((hook) => hook.stage === "build").length;
  expect(builds()).toBe(1);
  data(await Luna.apps.update(["gitapp"], options()));
  expect(builds()).toBe(1);
  f.write(f.upstream, "release.txt", "new release");
  f.commit("New release");
  data(await Luna.apps.update(["gitapp"], options()));
  expect(builds()).toBe(2);
  data(await Luna.apps.update(["gitapp"], { ...options(), force: true }));
  expect(builds()).toBe(3);
});

test("local updates rebuild and partial failures retain update retry commands", async () => {
  f.app("broken", { name: "broken", source: "local" }, ["build"]);
  f.app("last", { name: "last", source: "local" }, ["build"]);
  data(await Luna.apps.install([], options()));
  const result = data(
    await Luna.apps.update([], {
      ...options(),
      env: { ...f.env, APP_FAIL: "broken:build" },
      skipFailed: true,
    }),
  );
  expect(result).toMatchObject({ completed: false, updated: ["last"] });
  expect(result.failed[0]!.retry).toContain(" update 'broken'");
});

test.each(["pacman", "aur"])(
  "%s uninstall keeps settings/data and later purge removes declared files only",
  async (source) => {
    configuredApp(source);
    data(await Luna.apps.install(["editor"], options()));
    f.write(f.home, ".config/editor/config.jsonc", '{"personal":true}');
    f.write(f.home, ".local/share/editor/history", "personal data");
    f.write(f.home, ".local/share/unrelated/keep", "keep");
    expect(data(await Luna.apps.uninstall(["editor"], options())).uninstalled).toEqual(["editor"]);
    expect(readFileSync(join(f.home, ".config/editor/config.jsonc"), "utf8")).toContain("personal");
    expect(existsSync(join(f.home, ".local/share/editor/history"))).toBe(true);
    expect(existsSync(join(f.home, ".config/luna/editor/config.jsonc"))).toBe(true);
    expect(existsSync(join(f.home, ".config/luna/aliases/editor.zsh"))).toBe(false);
    expect(existsSync(join(f.home, ".local/state/luna/apps/editor.jsonc"))).toBe(false);
    expect(existsSync(join(f.home, ".local/state/luna/apps/editor.jsonc.lock"))).toBe(true);
    const beforePurge = f.commands().length;
    for (let attempt = 0; attempt < 2; attempt++)
      data(await Luna.apps.uninstall(["editor"], { ...options(), purge: true }));
    expect(
      f
        .commands()
        .slice(beforePurge)
        .some((call) => call.name === "sudo"),
    ).toBe(false);
    expect(existsSync(join(f.home, ".config/editor/config.jsonc"))).toBe(false);
    expect(existsSync(join(f.home, ".config/luna/editor/config.jsonc"))).toBe(false);
    expect(existsSync(join(f.home, ".local/share/editor"))).toBe(false);
    expect(readFileSync(join(f.home, ".local/share/unrelated/keep"), "utf8")).toBe("keep");
    expect(
      f
        .commands()
        .filter((call) => call.name === "pacman" && call.args[0] === "-R")
        .map((call) => call.args),
    ).toEqual([["-R", "--noconfirm", "--", "editor"]]);
  },
);

test("failed package removal retains exports, data and state for retry", async () => {
  configuredApp();
  data(await Luna.apps.install(["editor"], options()));
  f.write(f.home, ".local/share/editor/history", "keep");
  const result = await Luna.apps.uninstall(["editor"], {
    ...options(),
    env: { ...f.env, SELF_FAIL: "pacman:-R" },
    purge: true,
  });
  expect(result).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  expect(existsSync(join(f.home, ".config/luna/editor/config.jsonc"))).toBe(true);
  expect(existsSync(join(f.home, ".local/share/editor/history"))).toBe(true);
  expect(existsSync(join(f.home, ".local/state/luna/apps/editor.jsonc"))).toBe(true);
});

test("uninstall continues after app failures and preserves purge and process options in retries", async () => {
  f.app("broken", { name: "broken", source: "local" }, ["uninstall"]);
  f.app("last", { name: "last", source: "local" });
  data(await Luna.apps.install([], options()));
  const result = data(
    await Luna.apps.uninstall(["last", "broken"], {
      ...options(),
      env: { ...f.env, APP_FAIL: "broken:uninstall" },
      skipFailed: true,
      purge: true,
    }),
  );
  expect(result).toMatchObject({ completed: false, uninstalled: ["last"] });
  expect(result.failed[0]!.retry).toContain(" uninstall 'broken'");
  expect(result.failed[0]!.retry).toContain(" --purge --no-close-apps");
  expect(existsSync(join(f.home, ".local/state/luna/apps/broken.jsonc"))).toBe(true);
  expect(existsSync(join(f.home, ".local/state/luna/apps/last.jsonc"))).toBe(false);
});

test("Mise uninstall removes global activation and lets mise retain versions used by other projects", async () => {
  f.app("tool", { name: "tool", source: "mise" });
  data(await Luna.apps.uninstall(["tool"], options()));
  expect(f.commands().find((call) => call.name === "mise")?.args).toEqual([
    "--cd",
    f.home,
    "unuse",
    "--global",
    "--yes",
    "tool",
  ]);
});

test("custom uninstall hooks run on repeated removal and owned binaries are removed without source clones", async () => {
  f.app(
    "custom",
    {
      name: "custom",
      source: "git",
      url: f.upstream,
      cleanup: { uninstall: [["$HOME/.local/bin/custom"]] },
    },
    ["before_uninstall", "uninstall", "after_uninstall"],
  );
  f.write(f.home, ".local/bin/custom", "binary");
  f.write(f.home, ".local/share/luna/apps/git/custom/app", "binary");
  f.write(f.home, ".local/share/luna/git/clone/custom/personal", "keep");
  for (let attempt = 0; attempt < 2; attempt++)
    data(await Luna.apps.uninstall(["custom"], options()));
  expect(f.hooks().map((hook) => hook.stage)).toEqual([
    "before_uninstall",
    "uninstall",
    "after_uninstall",
    "before_uninstall",
    "uninstall",
    "after_uninstall",
  ]);
  expect(existsSync(join(f.home, ".local/bin/custom"))).toBe(false);
  expect(existsSync(join(f.home, ".local/share/luna/apps/git/custom"))).toBe(false);
  expect(existsSync(join(f.home, ".local/share/luna/git/clone/custom/personal"))).toBe(true);
});

test("uninstall requires names and rejects unsafe cleanup before package transactions", async () => {
  f.app("bad", { name: "bad", source: "pacman", cleanup: { purge: [["$HOME"]] } });
  expect(await Luna.apps.uninstall([], options())).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(await Luna.apps.uninstall(["bad"], { ...options(), purge: true })).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
  expect(f.commands().filter((call) => ["pacman", "sudo"].includes(call.name))).toEqual([]);
});

test("cleanup rejects linked parents and other apps' exports but unlinks a declared leaf", async () => {
  f.app("safe", { name: "safe", source: "local", cleanup: { purge: [["$HOME/data/link"]] } });
  f.write(f.home, "data/keep", "keep");
  f.write(f.home, "outside/keep", "keep");
  symlinkSync(join(f.home, "outside"), join(f.home, "data/link"));
  data(await Luna.apps.uninstall(["safe"], { ...options(), purge: true }));
  expect(existsSync(join(f.home, "outside/keep"))).toBe(true);
  f.app("linked", {
    name: "linked",
    source: "local",
    cleanup: { purge: [["$HOME/data/link/keep"]] },
  });
  symlinkSync(join(f.home, "outside"), join(f.home, "data/link"));
  expect(await Luna.apps.uninstall(["linked"], { ...options(), purge: true })).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
  f.app("other", {
    name: "other",
    source: "local",
    exports: [{ source: "missing", target: "shared" }],
  });
  f.app("overlap", {
    name: "overlap",
    source: "local",
    cleanup: { uninstall: [["$LUNA_CONFIG_HOME_DIR/shared"]] },
  });
  expect(await Luna.apps.uninstall(["overlap"], options())).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
});
