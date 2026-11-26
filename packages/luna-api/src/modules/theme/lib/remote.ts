import { open } from "node:fs/promises";
import { ApiError } from "@/lib/response.ts";
import { hasControlCharacters } from "@/lib/paths.ts";

/** HTTP transport shared by manifest inspection and asset imports; no external downloader. */
class ThemeRemote {
  url(input: string) {
    if (hasControlCharacters(input)) throw new ApiError("INVALID_ARGUMENT", "Invalid theme URL");
    const url = new URL(input);
    if (!/^https?:$/u.test(url.protocol) || url.username || url.password)
      throw new ApiError("INVALID_ARGUMENT", "Theme URLs must use HTTP(S) without credentials");
    return url;
  }

  private async _response(input: string) {
    let url = this.url(input);
    for (let redirect = 0; redirect <= 5; redirect++) {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
        headers: {
          "User-Agent": "Luna",
          Accept: url.hostname === "api.github.com" ? "application/vnd.github+json" : "*/*",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location)
          throw new ApiError("COMMAND_FAILED", "Theme download has no redirect location");
        url = this.url(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ApiError(
          "COMMAND_FAILED",
          `Theme download failed (${response.status}): ${url.href}`,
        );
      }
      return response;
    }
    throw new ApiError("COMMAND_FAILED", "Too many theme download redirects");
  }

  /** Bound untrusted metadata before parsing it. */
  async text(url: string) {
    const chunks: Uint8Array[] = [];
    await this._consume({
      url,
      limit: 8 * 1024 * 1024,
      write: async (chunk) => {
        chunks.push(chunk);
      },
    });
    return Buffer.concat(chunks).toString("utf8");
  }

  async download({ url, path }: { url: string; path: string }) {
    const file = await open(path, "wx", 0o600);
    try {
      await this._consume({
        url,
        limit: 128 * 1024 * 1024,
        write: async (chunk) => {
          await file.writeFile(chunk);
        },
      });
    } finally {
      await file.close();
    }
  }

  private async _consume({
    url,
    limit,
    write,
  }: {
    url: string;
    limit: number;
    write: (chunk: Uint8Array) => Promise<void>;
  }) {
    const response = await this._response(url);
    let size = 0;
    if (!response.body) throw new ApiError("INVALID_METADATA", "Empty theme download");
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > limit)
        throw new ApiError("INVALID_METADATA", "Theme download exceeds the size limit");
      await write(chunk);
    }
  }
}
export const themeRemote = new ThemeRemote();
