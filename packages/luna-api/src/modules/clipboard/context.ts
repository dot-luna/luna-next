import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "pathe";
import { metadata } from "@/lib/files.ts";
import { ordinaryParents } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";

export interface ClipboardOptions {
  /** Replaces Bun.env, including Wayland connection and cliphist database overrides. */
  env?: Record<string, string>;
}
export interface ClipboardPasteOptions extends ClipboardOptions {
  /** Window captured before the picker opens. Omit to paste into the currently focused window. */
  target?: string;
}

export function clipboardContext(options: ClipboardOptions) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? Bun.env))
    if (value !== undefined) env[key] = value;
  const root = env.XDG_RUNTIME_DIR || join(tmpdir(), `luna-${process.getuid?.() ?? "user"}`);
  if (!isAbsolute(root) || resolve(root) === "/")
    throw new ApiError("INVALID_PATH", "XDG_RUNTIME_DIR must be an absolute non-root path");
  return { env, runtime: join(root, "luna-clipboard") };
}
export type ClipboardContext = ReturnType<typeof clipboardContext>;

export function executable(context: ClipboardContext, name: string) {
  const path = Bun.which(name, { PATH: context.env.PATH ?? "" });
  if (!path) throw new ApiError("COMMAND_FAILED", `Install ${name} to use the clipboard`);
  return path;
}

/** Keep session logs and locks in a private directory, never through a symlink. */
export async function runtimeDirectory(context: ClipboardContext) {
  await ordinaryParents(join(context.runtime, "entry"));
  await mkdir(context.runtime, { recursive: true, mode: 0o700 });
  const info = await metadata(context.runtime);
  if (!info?.isDirectory() || info.uid !== process.getuid?.() || info.mode & 0o077)
    throw new ApiError(
      "INVALID_PATH",
      "Clipboard runtime directory must be private and owned by this user",
    );
  return context.runtime;
}

/** Clipboard bytes travel on stdin/stdout, never through shell arguments or text trimming. */
export async function command({
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
  const child = Bun.spawn([executable(context, args[0]!), ...args.slice(1)], {
    env: context.env,
    stdin: input ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const [output, stderr, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 && !allowFailure)
    throw new ApiError("COMMAND_FAILED", `${args[0]} failed (${code}): ${stderr.trim()}`);
  return { output: Buffer.from(output), stderr, code };
}
