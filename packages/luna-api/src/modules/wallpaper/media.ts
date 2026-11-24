import { capture } from "@/lib/process.ts";
import { ApiError } from "@/lib/response.ts";

export interface MediaContext {
  env: Record<string, string>;
}

/** Stable extensions keep unnamed HTTP downloads usable by desktop media tools. */
const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/x-ms-bmp": "bmp",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
};

class WallpaperMedia {
  /** Return the MIME type from file contents, not the extension; non-image/video throws INVALID_METADATA. */
  async validate({ context, path }: { context: MediaContext; path: string }) {
    const mime = await this._command({
      context,
      tool: "file",
      args: ["--mime-type", "--brief", "--", path],
    });
    if (!mime.startsWith("image/") && !mime.startsWith("video/"))
      throw new ApiError("INVALID_METADATA", `Unsupported wallpaper media: ${path}`);
    return mime;
  }

  /** Limit redirects to HTTP(S); curl never interprets the URL as a command option. */
  async download({ context, url, path }: { context: MediaContext; url: string; path: string }) {
    await this._command({
      context,
      tool: "curl",
      args: [
        "--disable",
        "--globoff",
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--proto",
        "=http,https",
        "--proto-redir",
        "=http,https",
        "--max-redirs",
        "10",
        "--max-time",
        "60",
        "--output",
        path,
        "--",
        url,
      ],
    });
  }

  extension(mime: string) {
    return extensions[mime] ?? mime.split("/")[1]!.replace(/[^a-z0-9]/giu, "");
  }

  /** Capture media tool diagnostics without printing or changing the caller's environment. */
  private async _command({
    context,
    tool,
    args,
  }: {
    context: MediaContext;
    tool: string;
    args: string[];
  }) {
    const executable = Bun.which(tool, { PATH: context.env.PATH ?? "" });
    if (!executable)
      throw new ApiError("COMMAND_FAILED", `Install ${tool} to manage wallpaper media`);
    const result = await capture({ args: [executable, ...args], env: context.env });
    if (result.code !== 0)
      throw new ApiError(
        "COMMAND_FAILED",
        `${tool} failed (${result.code}): ${(result.stderr || result.stdout).trim()}`,
      );
    return result.stdout.trim();
  }
}

export const wallpaperMedia = new WallpaperMedia();
