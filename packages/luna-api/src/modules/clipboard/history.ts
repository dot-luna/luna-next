import { entryLabel, fileLabel, fileNames } from "./presentation.ts";
import { ApiError } from "@/lib/response.ts";
import { command, executable, type ClipboardContext } from "./context.ts";
import { clipboardIdSchema, type ClipboardEntry, type ClipboardPreview } from "./schema.ts";

function entryInput(id: string) {
  if (!clipboardIdSchema.safeParse(id).success)
    throw new ApiError("INVALID_ARGUMENT", "Use a clipboard history ID");
  return Buffer.from(`${id}\t\n`);
}

export async function list(context: ClipboardContext): Promise<ClipboardEntry[]> {
  const result = await command({ context, args: ["cliphist", "list"], allowFailure: true });
  if (result.code !== 0) {
    // Cliphist reports a missing database as an error until the first captured entry.
    if (result.stderr.includes("please store something first")) return [];
    throw new ApiError("COMMAND_FAILED", `cliphist list failed: ${result.stderr.trim()}`);
  }
  const entries: ClipboardEntry[] = [];
  for (const line of result.output.toString("utf8").split("\n")) {
    const separator = line.indexOf("\t");
    const id = line.slice(0, separator);
    if (separator < 1 || !clipboardIdSchema.safeParse(id).success) continue;
    entries.push({ id, ...entryLabel(line.slice(separator + 1)) });
  }
  return entries;
}

async function decode({ context, id }: { context: ClipboardContext; id: string }) {
  const result = await command({ context, args: ["cliphist", "decode"], input: entryInput(id) });
  return result.output;
}

async function mimeType({ context, data }: { context: ClipboardContext; data: Uint8Array }) {
  const result = await command({
    context,
    args: ["file", "--brief", "--mime-type", "-"],
    input: data,
  });
  const mime = result.output.toString("utf8").trim();
  if (!/^[\w.+-]+\/[\w.+-]+$/u.test(mime))
    throw new ApiError("COMMAND_FAILED", "Could not identify the clipboard format");
  return mime;
}

function decodeText(data: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    return text.includes("\0") ? null : text;
  } catch {
    return null;
  }
}

export async function preview({
  context,
  id,
}: {
  context: ClipboardContext;
  id: string;
}): Promise<ClipboardPreview> {
  const data = await decode({ context, id });
  const mime = await mimeType({ context, data });
  const name = fileLabel(mime, `${data.length.toLocaleString("en-US")} bytes`);
  if (mime.startsWith("image/"))
    return { id, mime, name, text: "", image: `data:${mime};base64,${data.toString("base64")}` };
  const decoded = decodeText(data);
  // Structured text stays readable; document/archive bytes should not appear as raw text.
  const document = ["application/pdf", "application/postscript", "application/rtf"].includes(mime);
  const text = decoded !== null && !document ? (fileNames(decoded) ?? decoded) : name;
  return {
    id,
    mime,
    name: decoded !== null ? (fileNames(decoded) ?? name) : name,
    text,
    image: "",
  };
}

/** Copy exact bytes and promote the selected entry, even outside cliphist's deduplication window. */
export async function copy({ context, id }: { context: ClipboardContext; id: string }) {
  const data = await decode({ context, id });
  let mime = await mimeType({ context, data });
  // JSON, source code and other UTF-8 snippets must still paste into ordinary text fields.
  if (!mime.startsWith("image/") && decodeText(data) !== null) mime = "text/plain;charset=utf-8";
  await copyBytes({ context, data, mime });
  await command({ context, args: ["cliphist", "delete"], input: entryInput(id) });
  await command({ context, args: ["cliphist", "store"], input: data });
  return { id };
}

export async function remove({ context, id }: { context: ClipboardContext; id: string }) {
  await command({ context, args: ["cliphist", "delete"], input: entryInput(id) });
  return { id };
}

/** Restore one MIME representation without altering history; callers decide what to store. */
export async function copyBytes({
  context,
  data,
  mime,
}: {
  context: ClipboardContext;
  data: Uint8Array;
  mime: string;
}) {
  // wl-copy forks an owner that can retain output descriptors; do not capture pipes from it.
  const child = Bun.spawn([executable(context, "wl-copy"), "--type", mime], {
    env: context.env,
    stdin: data,
    stdout: "ignore",
    stderr: "ignore",
    timeout: 10_000,
  });
  const code = await child.exited;
  if (code !== 0) throw new ApiError("COMMAND_FAILED", `wl-copy failed (${code})`);
}
