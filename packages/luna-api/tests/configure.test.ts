import { afterEach, expect, test } from "bun:test";
import { $ } from "bun";
import { sandbox } from "./helpers.ts";

const fixtures: Awaited<ReturnType<typeof sandbox>>[] = [];
async function setup() { const value = await sandbox(); fixtures.push(value); return value; }
afterEach(async () => { for (const value of fixtures.splice(0)) await value.cleanup(); });

test("folder exports replace old contents, preserve excluded split exports, and leave unrelated paths", async () => {
  const s = await setup();
  const config = `${s.env.HOME}/.config/luna`;
  await s.app("kitty", { name: "kitty", source: "pacman", exports: [
    { source: "config", target: "kitty", exclude: ["entry.conf"] },
    { source: "config/entry.conf", target: "kitty/entry.conf" },
  ] });
  await s.file(`${s.repository}/apps/kitty/config/entry.conf`, '{"new":true}');
  await s.file(`${s.repository}/apps/kitty/config/theme.conf`, "new-theme");
  await s.file(`${config}/kitty/stale.conf`, "old");
  await s.file(`${config}/unrelated.conf`, "keep");
  const response = await s.apps.configure(["kitty"]);
  expect(response).toMatchObject({ ok: true });
  expect(await Bun.file(`${config}/kitty/entry.conf`).json()).toEqual({ new: true });
  expect(await Bun.file(`${config}/kitty/stale.conf`).exists()).toBe(false);
  expect(await Bun.file(`${config}/unrelated.conf`).text()).toBe("keep");
  expect(await Array.fromAsync(new Bun.Glob("**/*backup*").scan({ cwd: config }))).toEqual([]);
});

test("JSON integration preserves user values including arrays and null", async () => {
  const s = await setup();
  const destination = `${s.env.HOME}/settings.conf`;
  await s.app("app", { name: "app", source: "pacman", exports: [{ source: "defaults.conf", target: "app/settings.conf", user_config: { dest: ["$UNSET/settings.conf", destination], dest_mode: "merge" } }] });
  await s.file(`${s.repository}/apps/app/defaults.conf`, JSON.stringify({ nested: { keep: "default", missing: 1 }, array: [1, 2], nil: "default" }));
  await s.file(destination, JSON.stringify({ nested: { keep: "user" }, array: [], nil: null, personal: true }));
  expect((await s.apps.configure(["app"])).ok).toBe(true);
  expect(await Bun.file(destination).json()).toEqual({ nested: { keep: "user", missing: 1 }, array: [], nil: null, personal: true });
});

test("parent exports publish before nested split exports regardless of manifest order", async () => {
  const s = await setup();
  await s.app("app", { name: "app", source: "pacman", exports: [
    { source: "config/entry", target: "app/entry" },
    { source: "config", target: "app", exclude: ["entry"] },
  ] });
  await s.file(`${s.repository}/apps/app/config/entry`, "entry");
  await s.file(`${s.repository}/apps/app/config/other`, "other");
  expect((await s.apps.configure(["app"])).ok).toBe(true);
  expect(await Bun.file(`${s.env.HOME}/.config/luna/app/entry`).text()).toBe("entry");
  expect(await Bun.file(`${s.env.HOME}/.config/luna/app/other`).text()).toBe("other");
});

test("include integration is explicit, prepended, and idempotent", async () => {
  const s = await setup();
  const destination = `${s.env.HOME}/.zshrc`;
  await s.app("zsh", { name: "zsh", source: "pacman", exports: [{ source: "entry", target: "zsh/entry", user_config: { dest: ["$HOME/.zshrc"], dest_mode: "include", include: 'source "{{path}}"' } }] });
  await s.file(`${s.repository}/apps/zsh/entry`, "export TEST=1\n");
  await s.file(destination, "# personal\n");
  expect((await s.apps.configure(["zsh"])).ok).toBe(true);
  expect((await s.apps.configure(["zsh"])).ok).toBe(true);
  expect(await Bun.file(destination).text()).toBe(`source "${s.env.HOME}/.config/luna/zsh/entry"\n# personal\n`);
});

test("generated exports run between before_configure and after_configure hooks", async () => {
  const s = await setup();
  await s.app("app", { name: "app", source: "pacman", hooks: { before_configure: ["before"], after_configure: ["after"] }, exports: [{ source: "generated.conf", target: "app/config.conf" }] });
  for (const hook of ["before", "after"]) await s.file(`${s.repository}/apps/app/${hook}`, "#!/bin/sh\n", true);
  s.behavior(async request => {
    if (request.argv[0]?.endsWith("/before")) await s.file(`${s.repository}/apps/app/generated.conf`, "generated");
    if (request.argv[0]?.endsWith("/after")) expect(await Bun.file(`${s.env.HOME}/.config/luna/app/config.conf`).text()).toBe("generated");
    expect(request.cwd).toBe(`${s.repository}/apps/app`);
    expect(request.env.LUNA_CONFIG_HOME_DIR).toBe(`${s.env.HOME}/.config/luna`);
    return { exitCode: 0, stdout: "", stderr: "" };
  });
  expect((await s.apps.configure(["app"])).ok).toBe(true);
});

test("export traversal, source symlinks, and symlinked destinations are rejected", async () => {
  const s = await setup();
  await s.app("app", { name: "app", source: "pacman", exports: [{ source: "config", target: "../outside" }] });
  let response = await s.apps.configure(["app"]);
  expect(!response.ok && response.error.code).toBe("INVALID_PATH");
  await s.file(`${s.root}/outside`, "keep");
  await $`ln -s ${s.root}/outside ${s.repository}/apps/app/config`.quiet();
  await s.app("app", { name: "app", source: "pacman", exports: [{ source: "config", target: "app/config" }] });
  response = await s.apps.configure(["app"]);
  expect(!response.ok && response.error.code).toBe("INVALID_PATH");
  await $`rm ${s.repository}/apps/app/config`.quiet();
  await s.file(`${s.repository}/apps/app/config`, "new");
  await $`mkdir -p ${s.env.HOME}/.config/luna/app`.quiet();
  await $`ln -s ${s.root}/outside ${s.env.HOME}/.config/luna/app/config`.quiet();
  response = await s.apps.configure(["app"]);
  expect(!response.ok && response.error.code).toBe("INVALID_PATH");
  expect(await Bun.file(`${s.root}/outside`).text()).toBe("keep");
});
