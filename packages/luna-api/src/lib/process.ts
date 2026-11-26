export interface CaptureOptions {
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  /** Bytes for stdin; omitted input closes stdin. */
  input?: Uint8Array;
  timeout?: number;
}

/**
 * Run literal arguments without a shell and collect output. Exit codes are returned,
 * never thrown, so callers decide which failures are expected and how to report them.
 */
export async function capture({ args, env, cwd, input, timeout }: CaptureOptions) {
  const child = Bun.spawn(args, {
    env,
    cwd,
    stdin: input ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout,
  });
  const [output, stderr, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const bytes = Buffer.from(output);
  return { code, output: bytes, stdout: bytes.toString("utf8"), stderr };
}
