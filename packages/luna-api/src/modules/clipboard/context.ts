import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "pathe";
import { environment } from "@/lib/env.ts";
import { ApiError } from "@/lib/response.ts";

export interface ClipboardOptions {
  /** Replaces Bun.env, including Wayland connection and cliphist database overrides. */
  env?: Record<string, string>;
}
export interface ClipboardPasteOptions extends ClipboardOptions {
  /** Window captured before the picker opens. Omit to paste into the currently focused window. */
  target?: string;
}

export interface ClipboardContext {
  env: Record<string, string>;
  /** Private session directory for the watcher lock and log; created only by the watcher. */
  runtime: string;
}

class ClipboardContextResolver {
  /** Copy the selected environment and choose the runtime directory without touching files. */
  resolve(options: ClipboardOptions = {}): ClipboardContext {
    const env = environment(options.env);
    const root = env.XDG_RUNTIME_DIR || join(tmpdir(), `luna-${process.getuid?.() ?? "user"}`);
    if (!isAbsolute(root) || resolve(root) === "/")
      throw new ApiError("INVALID_PATH", "XDG_RUNTIME_DIR must be an absolute non-root path");
    return { env, runtime: join(root, "luna-clipboard") };
  }
}

export const clipboardContext = new ClipboardContextResolver();
