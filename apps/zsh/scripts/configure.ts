#!/usr/bin/env bun
/**
 * Generate optional mise completion for Luna's modular Zsh configuration.
 * Run with system Bun: bun apps/zsh/scripts/configure.ts
 *
 * Steps:
 * 1. Create generated/, which the manifest exports beside the installed Zsh modules.
 * 2. If mise is available, generate completion with HOME as its working directory.
 * 3. Atomically publish complete output; on missing/failed mise, discard stale output.
 *
 * before_configure runs this before exports and native source integration into .zshrc.
 * Completion generation is optional. Tool activation stays in Zsh so each shell uses
 * its current PATH; this hook never writes the user's startup files or installed modules.
 * Repeated runs replace the generated completion without backups.
 * This standalone Bun script needs ordinary Linux filesystem commands; mise is optional.
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
  const directory = Bun.fileURLToPath(new URL("../generated/", import.meta.url));
  const output = `${directory}mise-completion.zsh`;
  run(["mkdir", "-p", "--", directory]);

  const mise = Bun.which("mise");
  if (!mise) {
    run(["rm", "-f", "--", output]);
    console.warn("Mise is unavailable; skipping Zsh completion generation.");
    return;
  }
  const home = Bun.env.HOME;
  if (!home) throw new Error("HOME is required for mise completion generation.");
  const result = Bun.spawnSync([mise, "--cd", home, "completion", "zsh"], {
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  if (!result.success) {
    run(["rm", "-f", "--", output]);
    console.warn("Mise completion generation failed; skipping Zsh completion.");
    return;
  }

  const temporary = run(["mktemp", "--", `${directory}.completion-XXXXXX`]);
  try {
    await Bun.write(temporary, result.stdout);
    run(["mv", "-fT", "--", temporary, output]);
  } finally {
    run(["rm", "-f", "--", temporary]);
  }
}

try {
  await configure();
} catch (error) {
  console.error(`Configure Zsh: ${(error as Error).message}`);
  process.exitCode = 1;
}
