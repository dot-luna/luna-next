import { chmod, copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join } from "pathe";
import { ApiError } from "../../lib/response.ts";
import type { InstallContext } from "./command.ts";

/** Publish beside the destination so build/copy failures preserve the installed CLI. */
export async function buildCli(context: InstallContext, executable: string) {
  await context.execute(["mise", "--cd", context.home, "use", "--global", "--yes", "bun@latest"]);
  const bun = (await context.execute(["mise", "--cd", context.home, "which", "bun"])).stdout.trim();
  if (!bun.startsWith("/") || !(await Bun.file(bun).exists())) {
    throw new ApiError("INVALID_PATH", "mise did not return an installed Bun executable");
  }
  context.env.PATH = `${dirname(bun)}:${context.env.PATH ?? ""}`;
  await context.execute([bun, "install", "--frozen-lockfile"]);
  await context.execute([bun, "run", "--cwd", "src/luna-cli", "build"]);
  const directory = dirname(executable);
  await mkdir(directory, { recursive: true });
  const staging = await mkdtemp(join(directory, ".luna-"));
  try {
    const staged = join(staging, "luna");
    await copyFile(join(context.repository, "target/luna-bun"), staged);
    await chmod(staged, 0o755);
    await rename(staged, executable);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
