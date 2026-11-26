import { capture } from "@/lib/process.ts";
import { ApiError } from "@/lib/response.ts";
import { InstallContext } from "@/modules/self/install/command.ts";
import type { ThemeContext } from "./context.ts";

class ThemeCommand {
  /**
   * Run desktop tools and return trimmed stdout; API calls never print or read terminal input.
   * During self-install the command is recorded in the install log instead.
   * Throws COMMAND_FAILED on a nonzero exit.
   */
  async run({ context, args }: { context: Pick<ThemeContext, "env" | "log">; args: string[] }) {
    if (context.log) {
      const install = new InstallContext(
        context.env.LUNA_ROOT || process.cwd(),
        context.env.HOME || "",
        context.env,
        () => {},
        context.log,
      );
      return (await install.execute(args)).stdout.trim();
    }
    const result = await capture({ args, env: context.env });
    if (result.code !== 0)
      throw new ApiError(
        "COMMAND_FAILED",
        `${args[0]} failed (${result.code}): ${(result.stderr || result.stdout).trim()}`,
      );
    return result.stdout.trim();
  }
}

export const themeCommand = new ThemeCommand();
