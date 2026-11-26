import { ApiError } from "@/lib/response.ts";
import { clipboardTools } from "./tools.ts";
import type { ClipboardContext } from "./context.ts";
import { clipboardPresentation } from "./presentation.ts";
import { clipboardIdSchema, type ClipboardEntry, type ClipboardPreview } from "./schema.ts";

/** Read and change cliphist history; only copy replaces the current clipboard. */
class ClipboardHistory {
  async list(context: ClipboardContext): Promise<ClipboardEntry[]> {
    const result = await clipboardTools.run({
      context,
      args: ["cliphist", "list"],
      allowFailure: true,
    });
    if (result.code !== 0) {
      // Cliphist reports a missing database as an error until the first captured entry.
      if (result.stderr.includes("please store something first")) return [];
      throw new ApiError("COMMAND_FAILED", `cliphist list failed: ${result.stderr.trim()}`);
    }
    const entries: ClipboardEntry[] = [];
    for (const line of result.stdout.split("\n")) {
      const separator = line.indexOf("\t");
      const id = line.slice(0, separator);
      if (separator < 1 || !clipboardIdSchema.safeParse(id).success) continue;
      entries.push({ id, ...clipboardPresentation.entryLabel(line.slice(separator + 1)) });
    }
    return entries;
  }

  async preview({
    context,
    id,
  }: {
    context: ClipboardContext;
    id: string;
  }): Promise<ClipboardPreview> {
    const data = await this._decode({ context, id });
    const mime = await this._mimeType({ context, data });
    const name = clipboardPresentation.fileLabel({
      mime,
      detail: `${data.length.toLocaleString("en-US")} bytes`,
    });
    if (mime.startsWith("image/"))
      return { id, mime, name, text: "", image: `data:${mime};base64,${data.toString("base64")}` };
    const decoded = this._decodeText(data);
    const files = decoded === null ? null : clipboardPresentation.fileNames(decoded);
    // Structured text stays readable; document/archive bytes should not appear as raw text.
    const document = ["application/pdf", "application/postscript", "application/rtf"].includes(
      mime,
    );
    const text = decoded !== null && !document ? (files ?? decoded) : name;
    return { id, mime, name: files ?? name, text, image: "" };
  }

  /** Copy exact bytes and promote the selected entry, even outside cliphist's deduplication window. */
  async copy({ context, id }: { context: ClipboardContext; id: string }) {
    const data = await this._decode({ context, id });
    let mime = await this._mimeType({ context, data });
    // JSON, source code and other UTF-8 snippets must still paste into ordinary text fields.
    if (!mime.startsWith("image/") && this._decodeText(data) !== null)
      mime = "text/plain;charset=utf-8";
    await clipboardTools.copy({ context, data, mime });
    await clipboardTools.run({ context, args: ["cliphist", "delete"], input: this._entry(id) });
    await clipboardTools.run({ context, args: ["cliphist", "store"], input: data });
    return { id };
  }

  async remove({ context, id }: { context: ClipboardContext; id: string }) {
    await clipboardTools.run({ context, args: ["cliphist", "delete"], input: this._entry(id) });
    return { id };
  }

  async clear(context: ClipboardContext) {
    await clipboardTools.run({ context, args: ["cliphist", "wipe"] });
    return { cleared: true };
  }

  /** Cliphist selects entries by the ID column of a list line read from stdin. */
  private _entry(id: string) {
    if (!clipboardIdSchema.safeParse(id).success)
      throw new ApiError("INVALID_ARGUMENT", "Use a clipboard history ID");
    return Buffer.from(`${id}\t\n`);
  }

  private async _decode({ context, id }: { context: ClipboardContext; id: string }) {
    const result = await clipboardTools.run({
      context,
      args: ["cliphist", "decode"],
      input: this._entry(id),
    });
    return result.output;
  }

  private async _mimeType({ context, data }: { context: ClipboardContext; data: Uint8Array }) {
    const result = await clipboardTools.run({
      context,
      args: ["file", "--brief", "--mime-type", "-"],
      input: data,
    });
    const mime = result.stdout.trim();
    if (!/^[\w.+-]+\/[\w.+-]+$/u.test(mime))
      throw new ApiError("COMMAND_FAILED", "Could not identify the clipboard format");
    return mime;
  }

  /** Return strict UTF-8 text, or null for invalid UTF-8 and NUL-containing binary data. */
  private _decodeText(data: Uint8Array): string | null {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      return text.includes("\0") ? null : text;
    } catch {
      return null;
    }
  }
}

export const clipboardHistory = new ClipboardHistory();
