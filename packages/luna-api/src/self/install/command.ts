import { open, readFile } from "node:fs/promises";
import { InstallLog } from "../../install/log.ts";
import { ApiError } from "../../lib/response.ts";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Commands receive the installation environment without changing the caller's cwd or env. */
export class InstallContext {
  readonly log: InstallLog;
  readonly progress: (message: string) => void;
  constructor(
    readonly repository: string,
    readonly home: string,
    readonly env: Record<string, string>,
    readonly onProgress: (message: string) => void,
    log?: InstallLog,
  ) {
    this.log = log ?? new InstallLog(home, env);
    this.progress = (message) => {
      this.log.event({ type: "progress", message });
      onProgress(message);
    };
  }

  failure(error: unknown): ApiError {
    const original =
      error instanceof ApiError
        ? error
        : new ApiError("IO_ERROR", error instanceof Error ? error.message : String(error));
    const message = original.message.includes(`Logs: ${this.log.directory}`)
      ? original.message
      : `${original.message}\nLogs: ${this.log.directory}`;
    this.log.finish({
      completed: false,
      error: message,
      failed: this.log.failures,
      logDirectory: this.log.directory,
    });
    return new ApiError(original.code, message);
  }

  async execute(
    args: string[],
    allowFailure = false,
    cwd = this.repository,
    tailOnly = false,
  ): Promise<CommandResult> {
    const entry = this.log.command(args, cwd);
    try {
      // File descriptors avoid buffering long build output or waiting for descendant-held pipes.
      const child = Bun.spawn(args, {
        cwd,
        env: this.env,
        stdin: "inherit",
        stdout: Bun.file(entry.stdout),
        stderr: Bun.file(entry.stderr),
      });
      const exitCode = await child.exited;
      const output = async (path: string) => {
        if (!tailOnly) return readFile(path, "utf8");
        const file = await open(path, "r");
        try {
          const { size } = await file.stat();
          const bytes = Buffer.alloc(Math.min(size, 65536));
          const result = await file.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length));
          return bytes.subarray(0, result.bytesRead).toString("utf8");
        } finally {
          await file.close();
        }
      };
      const [stdout, stderr] = await Promise.all([output(entry.stdout), output(entry.stderr)]);
      this.log.event({ type: "exit", id: entry.id, exitCode });
      if (exitCode !== 0 && !allowFailure)
        throw new ApiError(
          "COMMAND_FAILED",
          `${args[0]} failed (${exitCode}): ${(stderr || stdout).trim()}\nCommand logs: ${entry.stdout}, ${entry.stderr}`,
        );
      return { stdout, stderr, exitCode };
    } catch (error) {
      throw this.failure(error);
    }
  }

  /** Refresh the existing sudo timestamp during long builds; refresh never prompts. */
  keepSudoAlive() {
    let running: Promise<unknown> | undefined;
    const timer = setInterval(() => {
      if (!running)
        running = this.execute(["sudo", "-n", "-v"], true)
          .catch((error) => this.log.event({ type: "sudo-refresh-failed", error: String(error) }))
          .finally(() => {
            running = undefined;
          });
    }, 60000);
    return async () => {
      clearInterval(timer);
      await running;
    };
  }

  git(args: string[], allowFailure = false) {
    return this.execute(["git", "-C", this.repository, ...args], allowFailure);
  }
}
