import { chmod, copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join } from "pathe";
import { ApiError } from "@/lib/response.ts";
import { migrationState } from "@/modules/self/migrations/state.ts";
import type { InstallContext } from "./command.ts";

class CliBuilder {
  /**
   * Build target/luna with mise's Bun and publish it to executable. Staging beside the
   * destination keeps the installed CLI unless the final rename succeeds. During an update,
   * publication also requires the build to have migrated state to the checkout version.
   * Prepends Bun's directory to context.env.PATH for later steps.
   */
  async build({ context, executable }: { context: InstallContext; executable: string }) {
    await context.execute(["mise", "--cd", context.home, "use", "--global", "--yes", "bun@latest"]);
    const bun = (
      await context.execute(["mise", "--cd", context.home, "which", "bun"])
    ).stdout.trim();
    if (!bun.startsWith("/") || !(await Bun.file(bun).exists())) {
      throw new ApiError("INVALID_PATH", "mise did not return an installed Bun executable");
    }
    context.env.PATH = `${dirname(bun)}:${context.env.PATH ?? ""}`;
    await context.execute([bun, "install", "--frozen-lockfile"]);
    await context.execute([bun, "run", "--cwd", "src/luna-cli", "build", "--no-install"]);
    if (
      context.env.LUNA_UPDATE_FROM_VERSION &&
      (await migrationState.read(context))?.version !==
        (await migrationState.checkoutVersion(context.repository))
    )
      throw new ApiError(
        "INVALID_METADATA",
        "The selected release did not complete its migrations",
      );
    const directory = dirname(executable);
    await mkdir(directory, { recursive: true });
    const staging = await mkdtemp(join(directory, ".luna-"));
    try {
      const staged = join(staging, "luna");
      await copyFile(join(context.repository, "target/luna"), staged);
      await chmod(staged, 0o755);
      await rename(staged, executable);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

export const cliBuilder = new CliBuilder();
