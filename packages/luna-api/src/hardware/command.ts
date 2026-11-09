import { isAbsolute } from "node:path";
import { ApiError } from "../lib/response.ts";
import type { HardwareCommand, HardwareCommandResult } from "./context.ts";

const OUTPUT_LIMIT = 64 * 1024;

/**
 * Run a trusted tool without a shell or inherited input. Limits apply while reading,
 * rather than after buffering unbounded output. A timeout stops waiting even when
 * pkexec has elevated its child beyond the caller's signal permissions.
 */
export async function runCommand({
  argv,
  timeoutMs,
}: HardwareCommand): Promise<HardwareCommandResult> {
  if (!argv[0] || !isAbsolute(argv[0]) || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new ApiError(
      "INVALID_ARGUMENT",
      "Hardware commands require an absolute executable and a positive timeout",
    );

  let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    child = Bun.spawn(argv, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      // Tools use the host system bus, deterministic output, and no loader/runtime overrides.
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    });
  } catch (error) {
    const missing =
      typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
    throw new ApiError(
      missing ? "INVALID_ENVIRONMENT" : "COMMAND_FAILED",
      `Cannot start ${argv[0]}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const readers = [child.stdout.getReader(), child.stderr.getReader()];
  const stop = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* The privileged helper owns its post-elevation deadline. */
    }
    child.unref();
    for (const reader of readers) void reader.cancel().catch(() => {});
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stop();
      reject(new ApiError("COMMAND_FAILED", `${argv[0]} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  async function capture(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > OUTPUT_LIMIT)
        throw new ApiError("COMMAND_FAILED", `${argv[0]} exceeded the hardware output limit`);
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  try {
    const [stdout, stderr, code] = await Promise.race([
      Promise.all([capture(readers[0]!), capture(readers[1]!), child.exited]),
      timeout,
    ]);
    return { stdout, stderr, code };
  } catch (error) {
    stop();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
