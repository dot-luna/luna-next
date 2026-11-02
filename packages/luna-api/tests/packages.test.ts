import { afterEach, expect, test } from "bun:test";
import { $ } from "bun";
import { createApps } from "../src/index.ts";
import { sandbox } from "./helpers.ts";

const fixtures: Awaited<ReturnType<typeof sandbox>>[] = [];
async function setup() { const value = await sandbox(); fixtures.push(value); return value; }
afterEach(async () => { for (const value of fixtures.splice(0)) await value.cleanup(); });

test("AUR and mise installation, update, and uninstallation use their selected backends", async () => {
  const s = await setup();
  await s.app("browser", { name: "browser-bin", source: "aur" });
  await s.app("tool", { name: "tool", source: "mise", version: "1.2.3" });
  s.behavior(request => ({ exitCode: request.argv.includes("-Q") || request.argv.includes("where") ? 1 : 0, stdout: "", stderr: "" }));
  expect((await s.apps.install(["browser", "tool"])).ok).toBe(true);
  expect(s.calls.map(call => call.argv)).toContainEqual(["yay", "-S", "--aur", "--needed", "--noconfirm", "--", "browser-bin"]);
  expect(s.calls.map(call => call.argv)).toContainEqual(["mise", "use", "--global", "--yes", "--", "tool@1.2.3"]);
  s.behavior(() => ({ exitCode: 0, stdout: "", stderr: "" }));
  expect((await s.apps.update(["browser"])).ok).toBe(true);
  expect(s.calls.at(-1)?.argv).toEqual(["yay", "-S", "--aur", "--noconfirm", "--", "browser-bin"]);
  expect((await s.apps.uninstall(["browser", "tool"])).ok).toBe(true);
  expect(s.calls.map(call => call.argv)).toContainEqual(["sudo", "pacman", "-R", "--noconfirm", "--", "browser-bin"]);
  expect(s.calls.at(-1)?.argv).toEqual(["mise", "uninstall", "--yes", "--", "tool@1.2.3"]);
});

test("local installs create only their managed link; uninstall preserves source and config", async () => {
  const s = await setup();
  await s.file(`${s.repository}/local-source/source`, "keep");
  await s.app("local", { name: "local", source: "local", url: "local-source", exports: [{ source: "config", target: "local/config" }] });
  await s.file(`${s.repository}/apps/local/config`, "configuration");
  expect((await s.apps.install(["local"])).ok).toBe(true);
  const link = `${s.env.HOME}/.local/share/luna/apps/local/local`;
  expect((await $`readlink ${link}`.text()).trim()).toBe(`${s.repository}/local-source`);
  expect((await s.apps.uninstall(["local"])).ok).toBe(true);
  expect((await $`test -L ${link}`.quiet().nothrow()).exitCode).toBe(1);
  expect(await Bun.file(`${s.repository}/local-source/source`).text()).toBe("keep");
  expect(await Bun.file(`${s.env.HOME}/.config/luna/local/config`).text()).toBe("configuration");
});

test("real Git lifecycle selects a stable release, passes its ref to hooks, and preserves the clone", async () => {
  const s = await setup();
  const remote = `${s.root}/remote`;
  await $`git init -q ${remote}`.quiet();
  await s.file(`${remote}/file`, "v1");
  await $`git -C ${remote} add file`.quiet();
  await $`git -C ${remote} -c user.name=Test -c user.email=test@example.com commit -qm initial`.quiet();
  await $`git -C ${remote} tag v1.0.0`.quiet();
  await $`git -C ${remote} tag v2.0.0-beta.1`.quiet();
  await s.app("gitapp", { name: "gitapp", source: "git", url: remote, version: "latest", hooks: { build: ["build"] } });
  await s.file(`${s.repository}/apps/gitapp/build`, '#!/bin/sh\nset -eu\nmkdir -p "$LUNA_GIT_APP_INSTALL_DIR/gitapp"\nprintf "%s" "$LUNA_PACKAGE_VERSION" > "$LUNA_GIT_APP_INSTALL_DIR/gitapp/version"\n', true);
  const apps = createApps({ env: s.env, logger: s.options.logger });
  const first = await apps.install(["gitapp"]);
  expect(first).toMatchObject({ ok: true });
  const install = `${s.env.HOME}/.local/share/luna/apps/git/gitapp`;
  expect(await Bun.file(`${install}/version`).text()).toBe("v1.0.0");
  const status = await apps.status(["gitapp"]);
  expect(status.ok && status.result.completed[0]?.status?.installed).toBe(true);
  expect((await apps.uninstall(["gitapp"])).ok).toBe(true);
  const removed = await apps.status(["gitapp"]);
  expect(removed.ok && removed.result.completed[0]?.status?.installed).toBe(false);
  const clone = `${s.env.HOME}/.local/share/luna/git/clone/gitapp`;
  expect(await Bun.file(`${clone}/file`).text()).toBe("v1");
  expect((await apps.install(["gitapp"])).ok).toBe(true);
  await s.file(`${remote}/file`, "v2");
  await $`git -C ${remote} add file`.quiet();
  await $`git -C ${remote} -c user.name=Test -c user.email=test@example.com commit -qm second`.quiet();
  await $`git -C ${remote} tag v2.0.0`.quiet();
  expect((await apps.update(["gitapp"])).ok).toBe(true);
  expect((await apps.update(["gitapp"])).ok).toBe(true);
  expect(await Bun.file(`${install}/version`).text()).toBe("v2.0.0");
  await s.file(`${clone}/file`, "personal edit");
  const update = await apps.update(["gitapp"]);
  expect(!update.ok && update.error.details).toMatchObject({ failed: { error: { code: "CONFLICT" } } });
  expect(await Bun.file(`${clone}/file`).text()).toBe("personal edit");
}, 15000);

test("a failed local build is retried instead of treating the link as an installed app", async () => {
  const s = await setup();
  await s.file(`${s.repository}/local-source/source`, "source");
  await s.app("local", { name: "local", source: "local", url: "local-source", hooks: { build: ["build"] } });
  await s.file(`${s.repository}/apps/local/build`, "#!/bin/sh\n", true);
  s.behavior(() => ({ exitCode: 1, stdout: "", stderr: "build failed" }));
  expect((await s.apps.install(["local"])).ok).toBe(false);
  const status = await s.apps.status(["local"]);
  expect(status.ok && status.result.completed[0]?.status?.installed).toBe(false);
  s.behavior(() => ({ exitCode: 0, stdout: "", stderr: "" }));
  expect((await s.apps.install(["local"])).ok).toBe(true);
  expect(s.calls.filter(call => call.argv[0]?.endsWith("/build"))).toHaveLength(2);
});

test("Git directory overrides cannot overlap configuration, state, local links, or locks", async () => {
  const s = await setup();
  await s.app("app", { name: "app", source: "git", url: "https://example.com/app.git" });
  const config = `${s.env.HOME}/.config/luna`;
  await s.file(`${config}/app/settings.conf`, "personal settings");
  const reserved = [config, `${s.env.HOME}/.local/share/luna/state`, `${s.env.HOME}/.local/share/luna/apps/local`, `${s.env.HOME}/.cache/luna/locks`];
  for (const variable of ["LUNA_GIT_APP_CLONE_DIR", "LUNA_GIT_APP_BUILD_DIR", "LUNA_GIT_APP_INSTALL_DIR"]) {
    for (const path of reserved) {
      for (const selected of [path, `${path}/nested`]) {
        s.env[variable] = selected;
        const response = await s.apps.uninstall(["app"]);
        expect(!response.ok && response.error.code).toBe("INVALID_PATH");
        expect(await Bun.file(`${config}/app/settings.conf`).text()).toBe("personal settings");
      }
    }
    delete s.env[variable];
  }
  expect(s.calls).toHaveLength(0);
});
