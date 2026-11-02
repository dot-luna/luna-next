import { afterEach, expect, test } from "bun:test";
import { $ } from "bun";
import * as api from "../src/index.ts";

const { Luna } = api;
const roots: string[] = [];
const metadata = {
  name: "@luna/test",
  version: "1.2.3-alpha",
  description: "Fixture desktop",
  homepage: "https://example.com",
  repository: { type: "git", url: "git+https://example.com/luna.git" },
  bugs: { url: "https://example.com/issues" },
  private: true,
};

async function fixture() {
  const root = (await $`mktemp -d`.text()).trim();
  roots.push(root);
  const repository = `${root}/repository`;
  await Bun.write(`${repository}/package.json`, JSON.stringify(metadata));
  return { root, repository };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await $`/usr/bin/rm -rf -- ${root}`.quiet();
});

test("Luna is the only runtime export and info returns JSON-compatible root metadata", async () => {
  const value = await fixture();
  expect(Object.keys(api)).toEqual(["Luna"]);
  const result = await Luna.info({ repository: value.repository, env: {} });
  expect(result.succes).toBe(true);
  if (!result.succes) throw new Error(result.errMessage);
  expect(result.data).toEqual({
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
    homepage: metadata.homepage,
    repository: metadata.repository.url,
    issues: metadata.bugs.url,
    ascii: [
      "     __    __  ___   _____",
      "    / /   / / / / | / /   |",
      "   / /   / / / /  |/ / /| |",
      "  / /___/ /_/ / /|  / ___ |",
      " /_____/\\____/_/ |_/_/  |_|",
      "",
    ].join("\n"),
  });
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  expect(result).not.toHaveProperty("err");
  expect(result).not.toHaveProperty("errMessage");
});

test("each call rereads metadata and resolves explicit, environment, then managed paths", async () => {
  const value = await fixture();
  const home = `${value.root}/home`;
  const managed = `${home}/.local/src/luna-next`;
  await Bun.write(`${managed}/package.json`, JSON.stringify({ ...metadata, version: "2.0.0" }));
  const env = { HOME: home, LUNA_ROOT: value.repository };
  expect(await Luna.info({ env })).toMatchObject({
    succes: true,
    data: { version: "1.2.3-alpha" },
  });
  expect(await Luna.info({ repository: managed, env })).toMatchObject({
    succes: true,
    data: { version: "2.0.0" },
  });
  expect(await Luna.info({ env: { HOME: home } })).toMatchObject({
    succes: true,
    data: { version: "2.0.0" },
  });
  await Bun.write(
    `${value.repository}/package.json`,
    JSON.stringify({ ...metadata, version: "3.0.0", description: "Updated desktop" }),
  );
  expect(await Luna.info({ env })).toMatchObject({
    succes: true,
    data: { version: "3.0.0", description: "Updated desktop" },
  });
});

test("missing paths and invalid metadata return readable JSON errors without data", async () => {
  const value = await fixture();
  const responses = [
    await Luna.info({ env: {} }),
    await Luna.info({ repository: `${value.root}/missing` }),
  ];
  for (const contents of [
    "{invalid",
    JSON.stringify({ ...metadata, version: "" }),
    JSON.stringify({ ...metadata, description: null }),
  ]) {
    await Bun.write(`${value.repository}/package.json`, contents);
    responses.push(await Luna.info({ repository: value.repository }));
  }
  expect(responses.map((result) => (result.succes ? "success" : result.err))).toEqual([
    "INVALID_PATH",
    "IO_ERROR",
    "INVALID_METADATA",
    "INVALID_METADATA",
    "INVALID_METADATA",
  ]);
  for (const result of responses) {
    expect(result.succes).toBe(false);
    if (result.succes) throw new Error("Expected an error");
    expect(result.errMessage.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("data");
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  }
});

test("optional project links may be absent", async () => {
  const value = await fixture();
  await Bun.write(
    `${value.repository}/package.json`,
    JSON.stringify({ name: "Luna", version: "1.0.0", description: "Desktop" }),
  );
  const result = await Luna.info({ repository: value.repository });
  expect(result.succes).toBe(true);
  if (!result.succes) throw new Error(result.errMessage);
  expect(Object.keys(result.data).sort()).toEqual(["ascii", "description", "name", "version"]);
});
