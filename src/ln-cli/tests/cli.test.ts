import { afterEach, expect, test } from "bun:test";
import { $ } from "bun";

const roots: string[] = [];
const entry = Bun.fileURLToPath(new URL("../src/index.ts", import.meta.url));

async function fixture() {
  const root = (await $`mktemp -d`.text()).trim();
  roots.push(root);
  const env = { HOME: `${root}/home`, PATH: "/usr/bin:/bin", LUNA_NEXT_ROOT: `${root}/repository` };
  await $`mkdir -p ${env.HOME}`.quiet();
  await Bun.write(`${env.LUNA_NEXT_ROOT}/apps/service/app.conf`, JSON.stringify({
    name: "service", source: "pacman", alias: ["svc"],
    runtime: { start: ["/bin/sh", "-c", "printf hook-output; printf hook-error >&2"], stop: ["/bin/true"] },
  }));
  return { root, env };
}

async function cli(args: string[], env: Record<string, string>) {
  const child = Bun.spawn([Bun.argv[0]!, entry, ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}

afterEach(async () => { for (const root of roots.splice(0)) await $`/usr/bin/rm -rf -- ${root}`.quiet(); });

test("help does not load manifests or require HOME", async () => {
  const response = await cli(["--help"], {});
  expect(response.exitCode).toBe(0);
  expect(response.stdout).toContain("Usage: luna");
  expect(response.stdout).toContain("uninstall");
  expect(response.stderr).toBe("");
});

test("list and info provide human output and standard JSON with global options at either level", async () => {
  const value = await fixture();
  const listed = await cli(["--json", "list"], value.env);
  expect(listed.exitCode).toBe(0);
  expect(JSON.parse(listed.stdout)).toMatchObject({ ok: true, result: [{ id: "service" }] });
  const info = await cli(["info", "svc", "--json"], value.env);
  expect(info.exitCode).toBe(0);
  expect(JSON.parse(info.stdout)).toMatchObject({ ok: true, result: { id: "service" } });
  const human = await cli(["info", "svc", "--no-color"], value.env);
  expect(human.stdout).toContain("Actions:");
  expect(human.stdout).not.toContain("\u001b");
});

test("JSON parse failures and operation failures have distinct nonzero exit codes", async () => {
  const value = await fixture();
  const parse = await cli(["restart", "--json"], value.env);
  expect(parse.exitCode).toBe(2);
  expect(JSON.parse(parse.stdout)).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  expect(parse.stderr).toBe("");
  const operation = await cli(["reload", "svc", "--json"], value.env);
  expect(operation.exitCode).toBe(1);
  expect(JSON.parse(operation.stdout)).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_ACTION" } });
});

test("child output never mixes with the CLI JSON result", async () => {
  const value = await fixture();
  const response = await cli(["start", "svc", "--json"], value.env);
  expect(response.exitCode).toBe(0);
  expect(JSON.parse(response.stdout)).toMatchObject({ ok: true, result: { completed: [{ app: "service" }] } });
  expect(response.stdout.trim().split("\n")).toHaveLength(1);
  expect(response.stderr).toContain("hook-output");
  expect(response.stderr).toContain("hook-error");
});

test("explicit repository wins over environment and updated manifests need no rebuild", async () => {
  const value = await fixture();
  const selected = `${value.root}/other`;
  const manifest = `${selected}/apps/other/app.conf`;
  await Bun.write(manifest, JSON.stringify({ name: "other", source: "pacman" }));
  const first = await cli(["--repo", selected, "list", "--json"], value.env);
  expect(JSON.parse(first.stdout)).toMatchObject({ result: [{ id: "other" }] });
  await Bun.write(manifest, JSON.stringify({ name: "renamed-package", source: "mise" }));
  const second = await cli(["list", "--repo", selected, "--json"], value.env);
  expect(JSON.parse(second.stdout)).toMatchObject({ result: [{ manifest: { name: "renamed-package", source: "mise" } }] });
});

test("compiled Bun CLI reads manifests from disk after compilation", async () => {
  const value = await fixture();
  const binary = `${value.root}/luna`;
  const build = Bun.spawn([Bun.argv[0]!, "build", "--compile", entry, "--outfile", binary], { stdout: "pipe", stderr: "pipe" });
  const [buildOutput, buildErrors, buildCode] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  expect(buildCode, buildOutput + buildErrors).toBe(0);
  const run = async () => {
    const child = Bun.spawn([binary, "list", "--json"], { env: value.env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exitCode, stderr).toBe(0);
    return JSON.parse(stdout);
  };
  expect(await run()).toMatchObject({ result: [{ manifest: { name: "service" } }] });
  await Bun.write(`${value.env.LUNA_NEXT_ROOT}/apps/service/app.conf`, JSON.stringify({ name: "updated", source: "mise" }));
  expect(await run()).toMatchObject({ result: [{ manifest: { name: "updated" } }] });
}, 15000);
