import { expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Luna } from "../../packages/luna-api/src/index.ts";
import { AppFixture } from "../../packages/luna-api/tests/fixtures/app-fixture.ts";

const loader = fileURLToPath(new URL("../../apps/hypr/config/fragments.lua", import.meta.url));
const script = `loaded = {}
dofile(arg[1])(arg[2])
print(table.concat(loaded, ","))`;
const run = (dir: string) =>
  Bun.spawnSync(["lua", "-", loader, dir], { stdin: Buffer.from(script) });

test("Hyprland loads every app fragment in name order and ignores other entries", () => {
  const root = mkdtempSync(join(tmpdir(), "luna hypr's "));
  try {
    const dir = join(root, "hypr.d");
    mkdirSync(join(dir, "nested.lua"), { recursive: true });
    for (const name of ["fastfetch", "bitwarden", "btop"])
      writeFileSync(join(dir, `${name}.lua`), `table.insert(loaded, ${JSON.stringify(name)})`);
    writeFileSync(join(dir, "notes.txt"), "error('not a fragment')");
    const result = run(dir);
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString().trim()).toBe("bitwarden,btop,fastfetch");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Hyprland starts without a fragment directory", () => {
  const result = run(join(tmpdir(), "luna-missing-hypr.d"));
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(result.stdout.toString().trim()).toBe("");
});

test("configuring Hyprland after an app keeps that app's fragment", async () => {
  const f = new AppFixture();
  try {
    const repo = fileURLToPath(new URL("../../", import.meta.url));
    for (const app of ["hypr", "bitwarden"])
      cpSync(join(repo, "apps", app), join(f.repository, "apps", app), { recursive: true });
    f.write(
      f.repository,
      "apps/apps.jsonc",
      '{"packages":["hypr/app.jsonc","bitwarden/app.jsonc"]}',
    );
    const options = { repository: f.repository, env: f.env };
    expect(await Luna.apps.configure(["bitwarden"], options)).toMatchObject({ succes: true });
    expect(await Luna.apps.configure(["hypr"], options)).toMatchObject({ succes: true });
    const fragments = join(f.home, ".config/luna/hypr.d");
    expect(readdirSync(fragments)).toEqual(["bitwarden.lua"]);
    expect(readFileSync(join(fragments, "bitwarden.lua"), "utf8")).toContain("SUPER + SHIFT + P");
  } finally {
    f.dispose();
  }
});
