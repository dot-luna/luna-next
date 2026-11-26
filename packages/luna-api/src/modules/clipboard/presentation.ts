/** Turn cliphist summaries and decoded bytes into short labels without opening referenced files. */
class ClipboardPresentation {
  /** Cliphist keeps bytes, not original attachment names. Use type/size unless a file URI supplies a name. */
  fileLabel({ mime, detail }: { mime: string; detail: string }) {
    const types: Record<string, string> = {
      "application/octet-stream": "File",
      "application/pdf": "PDF",
      "application/postscript": "PostScript",
      "application/rtf": "RTF",
      "application/zip": "ZIP",
      "application/gzip": "GZIP",
      "application/x-tar": "TAR",
      "application/x-7z-compressed": "7Z",
    };
    const type = types[mime] ?? mime.split("/")[1]?.replace(/^x-/u, "").toUpperCase() ?? "File";
    return `[${type}] ${detail}`;
  }

  /** File-manager clipboard formats carry URI lists, sometimes preceded by copy/cut. Never open these paths. */
  fileNames(text: string): string | null {
    const lines = text
      .trim()
      // Cliphist flattens line breaks in list summaries, while previews keep the original URI list.
      .replace(/^(?:copy|cut)\s+(?=file:\/\/)/u, "")
      .split(/\r?\n|\s+(?=file:\/\/)/u)
      .filter((line) => line && !line.startsWith("#"));
    if (lines[0] === "copy" || lines[0] === "cut") lines.shift();
    if (!lines.length || !lines.every((line) => line.startsWith("file://"))) return null;
    try {
      return lines
        .map((line) => {
          const url = new URL(line);
          const name = decodeURIComponent(
            url.pathname.split("/").filter(Boolean).at(-1) ?? "File",
          ).replace(/[\r\n\t]/gu, " ");
          const extension = name.match(/\.([a-z0-9]{1,10})$/iu)?.[1]?.toUpperCase();
          return `[${extension ?? "File"}] ${name}`;
        })
        .join(" · ");
    } catch {
      return null;
    }
  }

  /** Keep list loading cheap; attachment bytes are decoded only for visible rows or the selected preview. */
  entryLabel(name: string) {
    const binary = /^\[\[ binary data (.+) \]\]$/u.exec(name);
    if (!binary) {
      // URI summaries can be truncated. A visible row decodes the full list before showing all names.
      if (/^(?:(?:copy|cut)\s+)?file:\/\//u.test(name))
        return { name: this.fileNames(name) ?? "[File]", attachment: true };
      return { name };
    }
    const detail = binary[1]!;
    const image = /\b(png|jpe?g|gif|webp|bmp|tiff?|svg)\b/iu.exec(detail);
    return { name: `[${image ? image[1]!.toUpperCase() : "File"}] ${detail}`, attachment: true };
  }
}

export const clipboardPresentation = new ClipboardPresentation();
