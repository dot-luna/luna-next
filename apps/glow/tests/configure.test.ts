import { afterEach, expect, test } from "bun:test";

const roots: string[] = [];
const app = new URL("../", import.meta.url);

function run(args: string[], env = Bun.env): string {
  const result = Bun.spawnSync(args, { env, stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

async function fixture() {
  const root = run(["mktemp", "-d", "/tmp/luna-glow-test-XXXXXX"]);
  roots.push(root);
  const directory = `${root}/app with spaces`;
  for (const file of ["scripts/configure.ts", "config/glow.yml", "config/style.jsonc"]) {
    await Bun.write(`${directory}/${file}`, Bun.file(new URL(file, app)));
  }
  const theme = {
    colors: Object.fromEntries(["foreground", "dark_foreground", "accent", "secondary_accent",
      "link", "info", "error", "comment", "warning", "success"].map(role => [role, "#123456"])),
  };
  await Bun.write(`${root}/theme.json`, JSON.stringify({ ok: true, result: theme }));
  await Bun.write(`${root}/bin/luna`, `#!/usr/bin/env bun
if (Bun.argv.slice(2).join(" ") !== "theme get --json") process.exit(1);
console.log(await Bun.file(Bun.env.FIXTURE_THEME!).text());
`);
  run(["chmod", "+x", `${root}/bin/luna`]);
  const env = {
    ...Bun.env, PATH: `${root}/bin:${Bun.env.PATH}`, FIXTURE_THEME: `${root}/theme.json`,
    LUNA_CONFIG_HOME_DIR: `${root}/managed "Luna"`,
  };
  const generate = (variables = env) => run([Bun.which("bun")!, `${directory}/scripts/configure.ts`], variables);
  const outputs = async () => Promise.all(["style.json", "glow.yml"]
    .map(file => Bun.file(`${directory}/generated/${file}`).text()));
  return { root, directory, theme, env, generate, outputs };
}

afterEach(() => {
  for (const root of roots.splice(0)) run(["rm", "-r", "--", root]);
});

test("generation produces Glow's native formats, requested defaults, and a fresh Luna palette", async () => {
  const value = await fixture();
  const original = await Bun.file(`${value.directory}/config/style.jsonc`).text();
  value.generate();
  const [styleText, configText] = await value.outputs();
  const style = JSON.parse(styleText);
  expect(style.document.color).toBe("#123456");
  expect(style.code_block.chroma.keyword.color).toBe("#123456");
  expect(styleText).not.toContain("{{colors.");
  expect(style.image_text.format).toBe("Image: {{.text}} →");
  expect(styleText).not.toContain("background_color");
  expect(Bun.YAML.parse(configText)).toEqual({
    style: `${value.env.LUNA_CONFIG_HOME_DIR}/glow/style.json`,
    pager: true, mouse: true, all: true, showLineNumbers: true,
  });
  expect(await Bun.file(`${value.directory}/config/style.jsonc`).text()).toBe(original);

  value.theme.colors.accent = "#abcdef";
  await Bun.write(`${value.root}/theme.json`, JSON.stringify({ ok: true, result: value.theme }));
  value.generate();
  const [updated] = await value.outputs();
  expect(JSON.parse(updated).heading.color).toBe("#abcdef");
});

test("failed theme resolution, invalid install paths, and malformed templates preserve previous outputs", async () => {
  const value = await fixture();
  value.generate();
  const original = await value.outputs();
  for (const home of ["", "relative/path"]) {
    expect(() => value.generate({ ...value.env, LUNA_CONFIG_HOME_DIR: home })).toThrow("absolute install directory");
    expect(await value.outputs()).toEqual(original);
  }
  for (const response of [{ ok: false }, { ok: true, result: { colors: {} } }]) {
    await Bun.write(`${value.root}/theme.json`, JSON.stringify(response));
    expect(value.generate).toThrow();
    expect(await value.outputs()).toEqual(original);
  }
  await Bun.write(`${value.root}/theme.json`, JSON.stringify({ ok: true, result: value.theme }));
  await Bun.write(`${value.directory}/config/glow.yml`, "style: [unterminated\n");
  expect(value.generate).toThrow();
  expect(await value.outputs()).toEqual(original);
  await Bun.write(`${value.root}/bin/luna`, "#!/usr/bin/env bash\nexit 1\n");
  expect(value.generate).toThrow();
  expect(await value.outputs()).toEqual(original);
});
