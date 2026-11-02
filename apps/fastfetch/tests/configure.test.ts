import { afterEach, expect, test } from "bun:test";

const roots: string[] = [];
const app = new URL("../", import.meta.url);

type Config = {
  display: { color: { keys: string } };
  logo: { color: Record<string, string> };
  modules: (string | { type: string; format?: string })[];
};

function run(args: string[], env = Bun.env): string {
  const result = Bun.spawnSync(args, { env, stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

async function fixture() {
  const root = run(["mktemp", "-d", "/tmp/luna-fastfetch-test-XXXXXX"]);
  roots.push(root);
  const directory = `${root}/app with spaces`;
  for (const file of ["scripts/configure.ts", "config/config.jsonc"]) {
    await Bun.write(`${directory}/${file}`, Bun.file(new URL(file, app)));
  }
  const theme = {
    name: 'Night "Blue"',
    colors: {
      accent: "#123456", secondary_accent: "#654321", foreground: "#aabbcc",
      dark_foreground: "#445566", info: "#abcdef",
    },
  };
  await Bun.write(`${root}/theme.json`, JSON.stringify({ succes: true, data: theme }));
  await Bun.write(`${root}/bin/luna`, `#!/usr/bin/env bun
if (Bun.argv.slice(2).join(" ") !== "theme get --json") process.exit(1);
console.log(await Bun.file(Bun.env.FIXTURE_THEME!).text());
`);
  run(["chmod", "+x", `${root}/bin/luna`]);
  const env = { ...Bun.env, PATH: `${root}/bin:${Bun.env.PATH}`, FIXTURE_THEME: `${root}/theme.json` };
  const output = `${directory}/generated/config.jsonc`;
  const generate = () => run([Bun.which("bun")!, `${directory}/scripts/configure.ts`], env);
  return { root, directory, theme, env, output, generate };
}

afterEach(() => {
  for (const root of roots.splice(0)) run(["rm", "-r", "--", root]);
});

test("generation refreshes resolved colors, preserves the template, and produces native Fastfetch output without bold", async () => {
  const value = await fixture();
  const template = await Bun.file(`${value.directory}/config/config.jsonc`).text();
  value.generate();
  const rendered = await Bun.file(value.output).text();
  const config = Bun.JSONC.parse(rendered) as Config;
  expect(config.display.color.keys).toBe("#123456");
  expect(config.modules.find(item => typeof item !== "string" && item.type === "custom"))
    .toMatchObject({ format: 'Night "Blue"' });
  expect(JSON.stringify(config)).not.toContain("{{");
  expect(rendered).toContain("// Hardware:");
  expect(await Bun.file(`${value.directory}/config/config.jsonc`).text()).toBe(template);

  // Use the installed binary to catch unsupported or deprecated fields and ANSI font weight.
  const result = Bun.spawnSync(["fastfetch", "--config", value.output, "--pipe", "false", "--show-errors", "true"], {
    env: value.env, stdout: "pipe", stderr: "pipe",
  });
  expect(result.success).toBe(true);
  expect(result.stderr.toString()).toBe("");
  const output = result.stdout.toString();
  expect(output).not.toMatch(/Unknown|renamed|Invalid|error:/iu);
  expect(output).toContain("\x1b[38;2;18;52;86m");
  expect(output).toContain("󰏘");
  expect(output).not.toContain("Theme");
  for (const sequence of output.matchAll(/\x1b\[([\d;]*)m/gu)) {
    expect(sequence[1].split(";")[0]).not.toBe("1");
  }

  value.theme.colors.accent = "#fedcba";
  await Bun.write(`${value.root}/theme.json`, JSON.stringify({ succes: true, data: value.theme }));
  value.generate();
  const updated = Bun.JSONC.parse(await Bun.file(value.output).text()) as Config;
  expect(updated.logo.color["1"]).toBe("#fedcba");
});

test("theme failures leave the last generated configuration intact", async () => {
  const value = await fixture();
  value.generate();
  const original = await Bun.file(value.output).text();
  for (const response of [{ succes: false, error: "Theme unavailable" }, { succes: true, data: { ...value.theme, colors: {} } }]) {
    await Bun.write(`${value.root}/theme.json`, JSON.stringify(response));
    expect(value.generate).toThrow();
    expect(await Bun.file(value.output).text()).toBe(original);
  }
  await Bun.write(`${value.root}/bin/luna`, "#!/usr/bin/env bash\nexit 1\n");
  expect(value.generate).toThrow();
  expect(await Bun.file(value.output).text()).toBe(original);
});
