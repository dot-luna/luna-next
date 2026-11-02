import { ApiError } from "../../lib/response.ts";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Commands receive the installation environment without changing the caller's cwd or env. */
export class InstallContext {
  constructor(
    readonly repository: string,
    readonly home: string,
    readonly env: Record<string, string>,
    readonly progress: (message: string) => void,
  ) {}

  async execute(args: string[], allowFailure = false): Promise<CommandResult> {
    const child = Bun.spawn(args, {
      cwd: this.repository,
      env: this.env,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0 && !allowFailure) {
      throw new ApiError(
        "COMMAND_FAILED",
        `${args[0]} failed (${exitCode}): ${(stderr || stdout).trim()}`,
      );
    }
    return { stdout, stderr, exitCode };
  }

  git(args: string[], allowFailure = false) {
    return this.execute(["git", "-C", this.repository, ...args], allowFailure);
  }
}
