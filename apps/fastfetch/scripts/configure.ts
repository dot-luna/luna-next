#!/usr/bin/env bun
/**
 * Generate Fastfetch's native JSONC defaults using the current resolved Luna theme.
 * Run with system Bun: bun apps/fastfetch/scripts/configure.ts
 *
 * Steps:
 * 1. Read luna theme get --json once; the CLI owns theme resolution and validation.
 * 2. Substitute theme colors/name in config/config.jsonc, retaining its comments.
 * 3. Parse the rendered JSONC, then atomically replace generated/config.jsonc.
 *
 * before_configure runs this before the manifest exports the generated file.
 * Repeated runs refresh the palette. Luna owns export publication and merging;
 * this script never writes the user's configuration or changes terminal settings.
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
  const theme = response.result;
  const app = new URL("../", import.meta.url);
  const template = await Bun.file(new URL("config/config.jsonc", app)).text();
  const rendered = template.replace(/\{\{(colors\.[a-z_]+|name)\}\}/gu, (_, key: string) => {
    const value = key === "name" ? theme.name : theme.colors[key.slice("colors.".length)];
    if (typeof value !== "string") throw new Error(`Luna's resolved theme is missing ${key}.`);
    // Escape values for their JSON string context, including quoted theme names.
    return JSON.stringify(value).slice(1, -1);
  });
  Bun.JSONC.parse(rendered);

  // Finish resolution before touching output; rename a sibling file to avoid partial exports.
  const directory = Bun.fileURLToPath(new URL("generated/", app));
  run(["mkdir", "-p", "--", directory]);
  const temporary = run(["mktemp", "--", `${directory}.config-XXXXXX`]);
  try {
    await Bun.write(temporary, rendered);
    run(["mv", "-fT", "--", temporary, `${directory}config.jsonc`]);
  } finally {
    run(["rm", "-f", "--", temporary]);
  }
}

try {
  await configure();
} catch (error) {
  console.error(`Configure Fastfetch: ${(error as Error).message}`);
  process.exitCode = 1;
}
