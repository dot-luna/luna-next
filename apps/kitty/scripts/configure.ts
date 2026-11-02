#!/usr/bin/env bun
/**
 * Generate Kitty's native defaults and theme include using Luna's resolved theme.
 * Run with system Bun: bun apps/kitty/scripts/configure.ts
 *
 * Steps:
 * 1. Read luna theme get --json once; the CLI owns theme resolution and validation.
 * 2. Resolve colors and fonts in config/theme.conf and read config/kitty.conf.
 * 3. Atomically write generated/theme.conf and generated/kitty.conf as sibling files.
 *
 * before_configure runs this before the manifest exports the generated directory.
 * Kitty's native include connects Luna's entry to the user's config; personal settings
 * loaded afterward take precedence. Repeated runs refresh colors and the monospace font.
 * This script only writes generated defaults; Luna handles their installation and includes.
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
  const response = JSON.parse(run(["luna", "theme", "get", "--json"]));
  if (response.ok !== true) throw new Error("Luna could not resolve the current theme.");
  const app = new URL("../", import.meta.url);
  const config = await Bun.file(new URL("config/kitty.conf", app)).text();
  const template = await Bun.file(new URL("config/theme.conf", app)).text();
  const theme = template.replace(/\{\{(colors|fonts)\.([a-z_]+)\}\}/gu, (_, group: string, role: string) => {
    const value = response.result[group][role];
    if (typeof value !== "string") throw new Error(`Luna's resolved theme is missing ${group}.${role}.`);
    return value;
  });

  // Resolve both files before touching generated output. Luna publishes their exports.
  const directory = Bun.fileURLToPath(new URL("generated/", app));
  run(["mkdir", "-p", "--", directory]);
  for (const [name, contents] of [["theme.conf", theme], ["kitty.conf", config]]) {
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
  console.error(`Configure Kitty: ${(error as Error).message}`);
  process.exitCode = 1;
}
