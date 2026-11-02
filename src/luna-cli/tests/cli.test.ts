import { afterEach, expect, test } from "bun:test";
import { $ } from "bun";
import { Luna } from "@luna/api";

const roots: string[] = [];
const entry = Bun.fileURLToPath(new URL("../src/index.ts", import.meta.url));
const metadata = {
  name: "@luna/test",
  version: "1.2.3-alpha",
  description: "Fixture desktop",
  homepage: "https://example.com",
};

async function fixture() {
  const root = (await $`mktemp -d`.text()).trim();
  roots.push(root);
  const repository = `${root}/repository`;
  await Bun.write(`${repository}/package.json`, JSON.stringify(metadata));
  return { root, repository, env: { LUNA_ROOT: repository } };
}

async function cli(args: string[], env: Record<string, string>, executable?: string) {
  const child = Bun.spawn(executable ? [executable, ...args] : [Bun.argv[0]!, entry, ...args], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await $`/usr/bin/rm -rf -- ${root}`.quiet();
});

test("help needs no repository or HOME", async () => {
  const response = await cli(["--help"], {});
  expect(response.exitCode).toBe(0);
  expect(response.stdout).toContain("Usage: luna");
  expect(response.stdout).toContain("-v, --version");
  expect(response.stdout).not.toContain("--repo");
  expect(response.stdout).not.toContain("-V");
  expect(response.stdout).toContain("self");
  expect(response.stderr).toBe("");
});

test("default output shows the banner and options while JSON returns the unchanged API response", async () => {
  const value = await fixture();
  const expected = await Luna.info({ repository: value.repository });
  if (!expected.succes) throw new Error(expected.errMessage);
  const version = await cli(["--version"], value.env);
  expect(version).toEqual({ stdout: metadata.version + "\n", stderr: "", exitCode: 0 });
  const shortVersion = await cli(["-v"], value.env);
  expect(shortVersion).toEqual(version);
  const jsonVersion = await cli(["--json", "-v"], value.env);
  expect(JSON.parse(jsonVersion.stdout)).toEqual(expected);
  const info = await cli(["--json"], value.env);
  expect(info.exitCode).toBe(0);
  expect(JSON.parse(info.stdout)).toEqual(expected);
  expect(info.stderr).toBe("");
  expect(info.stdout.trim().split("\n")).toHaveLength(1);
  const human = await cli([], value.env);
  expect(human.exitCode).toBe(0);
  expect(human.stderr).toBe("");
  expect(human.stdout).toContain(`Luna ${metadata.version}`);
  expect(human.stdout).toContain(metadata.description);
  expect(human.stdout).toContain(expected.data.ascii.trimEnd());
  expect(human.stdout).toContain("Options:");
  expect(human.stdout).toContain("-v, --version");
  expect(human.stdout).toContain("--json");
  expect(human.stdout).not.toContain(metadata.homepage);
});

test("LUNA_ROOT selects the checkout before the managed path under HOME", async () => {
  const value = await fixture();
  const home = `${value.root}/home`;
  const other = `${home}/.local/src/luna-next`;
  await Bun.write(`${other}/package.json`, JSON.stringify({ ...metadata, version: "2.0.0" }));
  for (const [env, expectedVersion] of [
    [{ HOME: home, ...value.env }, metadata.version],
    [{ HOME: home }, "2.0.0"],
  ] as const) {
    const response = await cli(["-v"], env);
    expect(response.exitCode).toBe(0);
    expect(response.stdout).toBe(expectedVersion + "\n");
  }
});

test("missing or invalid metadata and unsupported commands return standard errors", async () => {
  const value = await fixture();
  const missingEnv = { LUNA_ROOT: `${value.root}/missing` };
  const missing = await cli(["--json"], missingEnv);
  expect(missing.exitCode).toBe(1);
  expect(JSON.parse(missing.stdout)).toEqual(
    await Luna.info({ repository: `${value.root}/missing` }),
  );
  expect(missing.stderr).toBe("");
  const humanFailure = await cli([], missingEnv);
  expect(humanFailure.exitCode).toBe(1);
  expect(humanFailure.stdout).toBe("");
  expect(humanFailure.stderr).toContain("IO_ERROR");
  expect(humanFailure.stderr).toContain("ERROR");
  for (const contents of ["{invalid", JSON.stringify({ ...metadata, version: "" })]) {
    await Bun.write(`${value.repository}/package.json`, contents);
    const invalid = await cli(["--version", "--json"], value.env);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toBe("");
    expect(JSON.parse(invalid.stdout)).toEqual(await Luna.info({ repository: value.repository }));
  }
  for (const args of [["info"], ["--repo", value.repository], ["-V"], ["install", "kitty"]]) {
    const removed = await cli([...args, "--json"], value.env);
    expect(removed.exitCode).toBe(2);
    expect(removed.stderr).toBe("");
    expect(JSON.parse(removed.stdout)).toMatchObject({
      succes: false,
      err: "INVALID_ARGUMENT",
      errMessage: expect.any(String),
    });
  }
});

test("default output supports metadata without optional project links", async () => {
  const value = await fixture();
  const { homepage: _homepage, ...minimal } = metadata;
  await Bun.write(`${value.repository}/package.json`, JSON.stringify(minimal));
  const response = await cli([], value.env);
  expect(response.exitCode).toBe(0);
  expect(response.stdout).toContain(metadata.description);
  expect(response.stdout).not.toContain("undefined");
  expect(response.stdout).not.toContain("Homepage:");
});

test("diagnostic colors respect the environment and never decorate JSON output", async () => {
  const value = await fixture();
  const env = { LUNA_ROOT: `${value.root}/missing`, FORCE_COLOR: "1" };
  const colored = await cli([], env);
  expect(colored.exitCode).toBe(1);
  expect(colored.stdout).toBe("");
  expect(colored.stderr).toContain("\u001b[");
  const plain = await cli([], { ...env, NO_COLOR: "1" });
  expect(plain.stderr).not.toContain("\u001b[");
  const json = await cli(["--json"], env);
  expect(json.exitCode).toBe(1);
  expect(json.stderr).toBe("");
  expect(JSON.parse(json.stdout)).toMatchObject({ succes: false, err: "IO_ERROR" });
});

test("compiled CLI reads changed package metadata without rebuilding", async () => {
  const value = await fixture();
  const executable = `${value.root}/luna`;
  const build = Bun.spawn([Bun.argv[0]!, "build", "--compile", entry, "--outfile", executable], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, errors, status] = await Promise.all([
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
    build.exited,
  ]);
  expect(status, output + errors).toBe(0);
  expect((await cli(["--version"], value.env, executable)).stdout).toBe(metadata.version + "\n");
  const updated = { ...metadata, version: "3.0.0", description: "Updated desktop" };
  await Bun.write(`${value.repository}/package.json`, JSON.stringify(updated));
  const info = await cli(["--json"], value.env, executable);
  expect(info.exitCode).toBe(0);
  expect(JSON.parse(info.stdout)).toEqual(await Luna.info({ repository: value.repository }));
  const failure = await cli([], { LUNA_ROOT: `${value.root}/missing`, NO_COLOR: "1" }, executable);
  expect(failure.exitCode).toBe(1);
  expect(failure.stdout).toBe("");
  expect(failure.stderr).toContain("IO_ERROR");
}, 15000);
