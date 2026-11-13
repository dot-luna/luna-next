#!/usr/bin/env bun
/**
 * Generate Luna's GTK 4 stylesheet from the resolved theme's blur settings.
 * Run with system Bun: bun apps/gtk/scripts/configure.ts
 *
 * GTK 4.24+ owns compositor blur through ext-background-effect-v1 and requests none by
 * default, so Hyprland skips blurring translucent GTK windows. A window backdrop-filter
 * makes GTK request the blur region; Hyprland still renders it with its own theme blur.
 * When the theme disables blur, the stylesheet requests none.
 *
 * before_configure runs this before the manifest exports generated/gtk.css.
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
  if (response.succes !== true) throw new Error("Luna could not resolve the current theme.");
  const blur = response.data.appearance?.blur;
  if (typeof blur?.enabled !== "boolean" || !Number.isInteger(blur.size) || blur.size <= 0) {
    throw new Error("Luna's resolved theme is missing appearance.blur.");
  }
  const css = blur.enabled ? `window {\n  backdrop-filter: blur(${blur.size}px);\n}\n` : "";

  const directory = Bun.fileURLToPath(new URL("../generated/", import.meta.url));
  run(["mkdir", "-p", "--", directory]);
  const temporary = run(["mktemp", "--", `${directory}.gtk-XXXXXX`]);
  try {
    await Bun.write(temporary, `/* Generated from Luna's theme blur. */\n${css}`);
    run(["mv", "-fT", "--", temporary, `${directory}gtk.css`]);
  } finally {
    run(["rm", "-f", "--", temporary]);
  }
}

try {
  await configure();
} catch (error) {
  console.error(`Configure GTK: ${(error as Error).message}`);
  process.exitCode = 1;
}
