import { capture } from "@/lib/process.ts";
import { ApiError } from "@/lib/response.ts";
import type { ClipboardContext } from "./context.ts";

class ClipboardTools {
  /** Find a clipboard tool on the context's PATH; missing tools raise COMMAND_FAILED. */
  executable({ context, name }: { context: ClipboardContext; name: string }) {
    const path = Bun.which(name, { PATH: context.env.PATH ?? "" });
    if (!path) throw new ApiError("COMMAND_FAILED", `Install ${name} to use the clipboard`);
    return path;
  }

  /** Clipboard bytes travel on stdin/stdout, never through shell arguments or text trimming. */
  async run({
    context,
    args,
    input,
    allowFailure = false,
  }: {
    context: ClipboardContext;
    args: string[];
    input?: Uint8Array;
    allowFailure?: boolean;
  }) {
    const [name, ...rest] = args;
    const result = await capture({
      args: [this.executable({ context, name: name! }), ...rest],
      env: context.env,
      input,
      timeout: 10_000,
    });
    if (result.code !== 0 && !allowFailure)
      throw new ApiError(
        "COMMAND_FAILED",
        `${name} failed (${result.code}): ${result.stderr.trim()}`,
      );
    return result;
  }

  /** Offer one MIME representation through wl-copy without altering history; callers decide what to store. */
  async copy({
    context,
    data,
    mime,
  }: {
    context: ClipboardContext;
    data: Uint8Array;
    mime: string;
  }) {
    // wl-copy forks an owner that can retain output descriptors; do not capture pipes from it.
    const child = Bun.spawn([this.executable({ context, name: "wl-copy" }), "--type", mime], {
      env: context.env,
      stdin: data,
      stdout: "ignore",
      stderr: "ignore",
      timeout: 10_000,
    });
    const code = await child.exited;
    if (code !== 0) throw new ApiError("COMMAND_FAILED", `wl-copy failed (${code})`);
  }
}

export const clipboardTools = new ClipboardTools();
