import { ApiError } from "./response.ts";
import type { CommandRequest, CommandResult, CommandRunner, Context } from "./apps/types.ts";

/** Both child output streams go to stderr unless stdout is explicitly queried. */
export const runCommand: CommandRunner = async (request: CommandRequest): Promise<CommandResult> => {
  const child = Bun.spawn(request.argv, {
    cwd: request.cwd,
    env: request.env,
    stdin: "ignore",
    stdout: request.capture ? "pipe" : 2,
    stderr: 2,
  });
  const stdout = request.capture ? await new Response(child.stdout as ReadableStream).text() : "";
  const exitCode = await child.exited;
  return { exitCode, stdout, stderr: "" };
};

export async function command(context: Context, argv: string[], cwd = context.repository, capture = false, env = context.env): Promise<CommandResult> {
  context.logger.debug({ argv, cwd }, "Running command");
  return context.run({ argv, cwd, env, capture });
}

export async function checked(context: Context, argv: string[], cwd = context.repository, capture = false, env = context.env): Promise<string> {
  const result = await command(context, argv, cwd, capture, env);
  if (result.exitCode !== 0) {
    throw new ApiError("COMMAND_FAILED", `${argv[0]} exited with status ${result.exitCode}`, {
      argv, exitCode: result.exitCode, stderr: result.stderr,
    });
  }
  return result.stdout.trim();
}
