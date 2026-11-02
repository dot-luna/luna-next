#!/usr/bin/env bun
/**
 * Generate Glow's YAML defaults and native JSON stylesheet from Luna's theme.
 * Run with system Bun and LUNA_CONFIG_HOME_DIR set to Luna's config install directory.
 *
 * Steps:
 * 1. Read luna theme get --json once; the CLI owns theme resolution and validation.
 * 2. Resolve colors in config/style.jsonc and serialize plain JSON for Glow.
 * 3. Render config/glow.yml with the absolute installed stylesheet path.
 * 4. Parse both outputs, then atomically replace each file in generated/.
 *
 * before_configure runs this before the manifest exports and merges the defaults.
 * Glow has no native config includes. Luna handles merging, with user settings winning.
 * The stylesheet path must be absolute: Glow does not expand it consistently at render time.
 * Repeated runs refresh the palette without writing the user's live configuration.
 * This standalone Bun script needs Luna and ordinary Linux filesystem commands.
 */

function run(args: string[]): string {
  const result = Bun.spawnSync(args, {
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 15_000,
  });
  if (!result.success) {
    throw new Error(`${args[0]}: ${result.stderr.toString().trim() || result.exitCode}`);
  }
  return result.stdout.toString().trim();
}

async function configure(): Promise<void> {
  const home = Bun.env.LUNA_CONFIG_HOME_DIR;
  if (!home?.startsWith("/")) throw new Error("LUNA_CONFIG_HOME_DIR must be an absolute install directory.");

  const response = JSON.parse(run(["luna", "theme", "get", "--json"]));
  if (response.ok !== true) throw new Error("Luna could not resolve the current theme.");
  const app = new URL("../", import.meta.url);
  const template = await Bun.file(new URL("config/style.jsonc", app)).text();
  // Replace only Luna color tokens; retain Glamour's own format placeholders.
  const rendered = template.replace(/\{\{colors\.([a-z_]+)\}\}/gu, (_, role: string) => {
    const value = response.result.colors[role];
    if (typeof value !== "string") throw new Error(`Luna's resolved theme is missing colors.${role}.`);
    return JSON.stringify(value).slice(1, -1);
  });
  const style = `${JSON.stringify(Bun.JSONC.parse(rendered), null, 2)}\n`;
  const stylePath = `${home.replace(/\/+$/u, "")}/glow/style.json`;
  const config = (await Bun.file(new URL("config/glow.yml", app)).text())
    .replace("{{style_path}}", JSON.stringify(stylePath));
  Bun.YAML.parse(config);

  // Resolve both outputs before touching generated files. Luna publishes their exports.
  const directory = Bun.fileURLToPath(new URL("generated/", app));
  run(["mkdir", "-p", "--", directory]);
  for (const [name, contents] of [["style.json", style], ["glow.yml", config]]) {
    const temporary = run(["mktemp", "--", `${directory}.config-XXXXXX`]);
    try {
      await Bun.write(temporary, contents);
      run(["mv", "-fT", "--", temporary, `${directory}${name}`]);
    } finally {
      run(["rm", "-f", "--", temporary]);
    }
  }
}

try {
  await configure();
} catch (error) {
  console.error(`Configure Glow: ${(error as Error).message}`);
  process.exitCode = 1;
}
