import { chmod, copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Build beside the checkout; publish atomically unless bootstrap/update owns publication. */
async function build() {
  const args = Bun.argv.slice(2);
  if (args.some((arg) => arg !== "--no-install"))
    throw new Error("Usage: bun run build [--no-install]");
  const artifact = resolve(import.meta.dir, "../../../target/luna");
  const child = Bun.spawn(
    [
      process.execPath,
      "build",
      "--compile",
      join(import.meta.dir, "index.ts"),
      "--outfile",
      artifact,
    ],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await child.exited) !== 0) throw new Error("CLI build failed");
  if (args.includes("--no-install")) return;
  const home = Bun.env.HOME;
  if (!home || !home.startsWith("/") || resolve(home) === "/")
    throw new Error("HOME must be an absolute user home");
  const destination = join(home, ".local/bin/luna");
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(join(dirname(destination), ".luna-build-"));
  try {
    const staged = join(staging, "luna");
    await copyFile(artifact, staged);
    await chmod(staged, 0o755);
    await rename(staged, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  console.log(`Installed ${destination}`);
}

if (import.meta.main) {
  try {
    await build();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
