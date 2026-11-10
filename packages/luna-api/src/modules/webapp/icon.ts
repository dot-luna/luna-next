import { stat } from "node:fs/promises";
import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import { webappIconSourceSchema, webappManifestSchema, webappUrlSchema } from "./schema.ts";

const maxIconBytes = 8 * 1024 * 1024;

// Installation and removal share this list so obsolete icon formats can be cleaned up.
export const iconExtensions = ["png", "svg", "ico", "jpeg", "webp", "gif", "bmp"] as const;

type IconExtension = (typeof iconExtensions)[number];
type WebsiteIcon = {
  bytes: Buffer;
  extension: IconExtension;
  /** Shortest image edge in pixels; scalable SVGs rank above raster images with Infinity. */
  size: number;
};
type PageLink = { relations: string[]; href: string };

/** Discover site icons without storing request state on the shared instance. */
class WebappIcon {
  /** Resolve a relative URL and reject credentials or schemes other than HTTP(S). */
  private _resolveHttpUrl({ url, baseUrl }: { url: string; baseUrl: string }) {
    try {
      const validatedUrl = webappUrlSchema.safeParse(new URL(url, baseUrl).href);
      return validatedUrl.success ? validatedUrl.data : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Download a resource within a byte limit and a shared discovery deadline.
   * Allow at most five redirects and five seconds for this entire redirect chain.
   * Rejected responses return undefined; network and timeout errors reach the caller.
   */
  private async _downloadResource({
    url,
    deadline,
    maxBytes,
  }: {
    url: string;
    deadline: AbortSignal;
    maxBytes: number;
  }) {
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(5000)]);
    for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
      const response = await fetch(url, { redirect: "manual", signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const redirectLocation = response.headers.get("location");
        const redirectUrl =
          redirectLocation && this._resolveHttpUrl({ url: redirectLocation, baseUrl: url });
        if (!redirectUrl) return;
        url = redirectUrl;
        continue;
      }
      if (!response.ok || Number(response.headers.get("content-length")) > maxBytes) {
        await response.body?.cancel();
        return;
      }
      if (!response.body) return;

      const chunks: Uint8Array[] = [];
      let downloadedBytes = 0;
      const bodyReader = response.body.getReader();
      try {
        while (true) {
          const { done, value: chunk } = await bodyReader.read();
          if (done) return { url, bytes: Buffer.concat(chunks, downloadedBytes) };
          downloadedBytes += chunk.length;
          // Content-Length can be absent or incorrect; enforce the limit while streaming too.
          if (downloadedBytes > maxBytes) return;
          chunks.push(chunk);
        }
      } finally {
        await bodyReader.cancel();
      }
    }
  }

  /**
   * Read an ICO directory after its header has been identified by _readIcon.
   * Reject empty or out-of-bounds image entries and rank the largest advertised image.
   * This validates the directory structure, not the encoded pixels inside each entry.
   */
  private _readIco(bytes: Buffer): WebsiteIcon | undefined {
    const imageCount = bytes.readUInt16LE(4);
    const directoryEnd = 6 + imageCount * 16;
    if (!imageCount || bytes.length < directoryEnd) return;

    let largestImageSize = 0;
    for (let imageIndex = 0; imageIndex < imageCount; imageIndex++) {
      const entryOffset = 6 + imageIndex * 16;
      const imageByteLength = bytes.readUInt32LE(entryOffset + 8);
      const imageOffset = bytes.readUInt32LE(entryOffset + 12);
      if (
        !imageByteLength ||
        imageOffset < directoryEnd ||
        imageOffset + imageByteLength > bytes.length
      )
        return;
      // ICO stores 256-pixel dimensions as zero in its one-byte width and height fields.
      const width = bytes[entryOffset] || 256;
      const height = bytes[entryOffset + 1] || 256;
      largestImageSize = Math.max(largestImageSize, Math.min(width, height));
    }
    return { bytes, extension: "ico", size: largestImageSize };
  }

  /**
   * Identify supported image bytes and their ranking size without converting the source.
   * Prefer valid SVGs; bound raster inspection to 4096 × 4096 pixels.
   * Unsupported or malformed content returns undefined, even after a successful HTTP response.
   */
  private async _readIcon(bytes: Buffer): Promise<WebsiteIcon | undefined> {
    try {
      if (Bun.XML.parse(bytes, { compact: false }).name === "svg")
        return { bytes, extension: "svg", size: Infinity };
    } catch {
      // Invalid XML must not outrank a usable raster icon.
    }
    if (bytes.length >= 6 && bytes.readUInt32LE(0) === 0x10000) return this._readIco(bytes);

    try {
      const { width, height, format } = await new Bun.Image(bytes, {
        maxPixels: 4096 * 4096,
      }).metadata();
      const extension = iconExtensions.find((supportedFormat) => supportedFormat === format);
      if (extension && width > 0 && height > 0)
        return { bytes, extension, size: Math.min(width, height) };
    } catch {
      // Login pages and unsupported images are common responses at otherwise valid icon URLs.
    }
  }

  /** Read link relations and the first declared base URL without executing page scripts. */
  private _readPageLinks({ bytes, url }: { bytes: Buffer; url: string }) {
    let baseUrl = url;
    let hasBaseUrl = false;
    const links: PageLink[] = [];
    new HTMLRewriter()
      .on("base[href]", {
        element: (element) => {
          if (hasBaseUrl) return;
          hasBaseUrl = true;
          // An invalid first base falls back to the page URL; later base tags remain ignored.
          baseUrl = this._resolveHttpUrl({ url: element.getAttribute("href")!, baseUrl: url }) || url;
        },
      })
      .on("link[href][rel]", {
        element(element) {
          links.push({
            relations: element.getAttribute("rel")!.toLowerCase().split(/\s+/u),
            href: element.getAttribute("href")!,
          });
        },
      })
      .transform(bytes.toString("utf8"));
    return { baseUrl, links };
  }

  /**
   * Read eligible manifest icons, resolving their URLs against the manifest's final URL.
   * Accept omitted purposes, any, and maskable; ignore monochrome-only icons.
   * A missing, malformed, or unreachable manifest yields no candidates.
   */
  private async _readManifestIconUrls({ url, deadline }: { url: string; deadline: AbortSignal }) {
    const iconUrls: string[] = [];
    try {
      const manifest = await this._downloadResource({ url, deadline, maxBytes: 2 * 1024 * 1024 });
      if (!manifest) return iconUrls;
      const validatedManifest = webappManifestSchema.safeParse(
        JSON.parse(manifest.bytes.toString("utf8")),
      );
      if (!validatedManifest.success) return iconUrls;

      for (const icon of validatedManifest.data.icons) {
        if (!icon) continue;
        if (
          icon.purpose &&
          !icon.purpose.split(/\s+/u).some((purpose) => ["any", "maskable"].includes(purpose))
        )
          continue;
        const iconUrl = this._resolveHttpUrl({ url: icon.src, baseUrl: manifest.url });
        if (iconUrl) iconUrls.push(iconUrl);
      }
    } catch {
      // Manifest failures must not prevent discovery of icons declared in the page itself.
    }
    return iconUrls;
  }

  /**
   * Collect up to 24 unique HTTP(S) icon URLs, preferring manifest order over page links.
   * Try the conventional favicon after declared icons, within the same candidate limit.
   * A failed page request still permits a favicon attempt using the original page URL.
   */
  private async _findIconUrls({ url, deadline }: { url: string; deadline: AbortSignal }) {
    const candidateUrls = new Set<string>();
    // Keep discovery order: equally sized icons are resolved in favor of the first candidate.
    const addCandidateUrl = (candidateUrl: string) => {
      if (candidateUrls.size < 24) candidateUrls.add(candidateUrl);
    };
    let pageUrl = url;
    try {
      const page = await this._downloadResource({ url, deadline, maxBytes: 2 * 1024 * 1024 });
      if (page) {
        pageUrl = page.url;
        const { baseUrl, links } = this._readPageLinks(page);
        const manifestLink = links.find((link) => link.relations.includes("manifest"));
        const manifestUrl =
          manifestLink && this._resolveHttpUrl({ url: manifestLink.href, baseUrl });
        if (manifestUrl) {
          const manifestIconUrls = await this._readManifestIconUrls({ url: manifestUrl, deadline });
          for (const iconUrl of manifestIconUrls) addCandidateUrl(iconUrl);
        }
        for (const link of links) {
          if (
            !link.relations.some((relation) =>
              ["icon", "apple-touch-icon", "apple-touch-icon-precomposed"].includes(relation),
            )
          )
            continue;
          const iconUrl = this._resolveHttpUrl({ url: link.href, baseUrl });
          if (iconUrl) addCandidateUrl(iconUrl);
        }
      }
    } catch {
      // The conventional favicon may still be available when page retrieval or parsing fails.
    }
    const faviconUrl = this._resolveHttpUrl({ url: "/favicon.ico", baseUrl: pageUrl });
    if (faviconUrl) addCandidateUrl(faviconUrl);
    return [...candidateUrls];
  }

  /** Download one candidate within 8 MiB; failed requests and unusable images are optional. */
  private async _downloadIcon({ url, deadline }: { url: string; deadline: AbortSignal }) {
    try {
      const response = await this._downloadResource({ url, deadline, maxBytes: maxIconBytes });
      return response && (await this._readIcon(response.bytes));
    } catch {
      return undefined;
    }
  }

  /**
   * Load an explicitly selected icon from a local file or a direct HTTP(S) URL.
   * Relative paths use the caller's working directory. Retain original bytes and detect
   * the format from content, limiting input to 8 MiB. Explicit failures never fall back
   * to a different icon; the caller can leave its existing installation unchanged.
   */
  async load(source: string): Promise<WebsiteIcon> {
    const iconSource = validate(webappIconSourceSchema, source, "Web app icon");
    let bytes: Buffer;
    if (/^https?:/iu.test(iconSource)) {
      const resource = await this._downloadResource({
        url: iconSource,
        deadline: AbortSignal.timeout(5000),
        maxBytes: maxIconBytes,
      });
      if (!resource)
        throw new ApiError("IO_ERROR", `Unable to download web app icon within 8 MiB: ${iconSource}`);
      bytes = resource.bytes;
    } else {
      const sourceMetadata = await stat(iconSource);
      if (!sourceMetadata.isFile())
        throw new ApiError("INVALID_PATH", `Web app icon must be a file: ${iconSource}`);
      if (sourceMetadata.size > maxIconBytes)
        throw new ApiError("INVALID_METADATA", "Web app icons must not exceed 8 MiB");
      // Bound the read too: the source can grow after its metadata was inspected.
      bytes = Buffer.from(await Bun.file(iconSource).slice(0, maxIconBytes + 1).arrayBuffer());
      if (bytes.length > maxIconBytes)
        throw new ApiError("INVALID_METADATA", "Web app icons must not exceed 8 MiB");
    }
    const icon = await this._readIcon(bytes);
    if (!icon)
      throw new ApiError("INVALID_METADATA", `Unsupported or malformed web app icon: ${iconSource}`);
    return icon;
  }

  /**
   * Find the best usable site icon and return its original bytes, format, and ranking size.
   * Share a 15-second network deadline across discovery and downloads, with four candidates
   * fetched at a time. Prefer SVG, then the largest shortest edge; preserve discovery order on ties.
   * Return undefined when none is usable so web app installation can use its generic icon.
   */
  async downloadBest(url: string): Promise<WebsiteIcon | undefined> {
    const deadline = AbortSignal.timeout(15000);
    const candidateUrls = await this._findIconUrls({ url, deadline });
    let bestIcon: WebsiteIcon | undefined;
    for (let batchStart = 0; batchStart < candidateUrls.length && !deadline.aborted; batchStart += 4) {
      const downloadedIcons = await Promise.all(
        candidateUrls.slice(batchStart, batchStart + 4).map((candidateUrl) =>
          this._downloadIcon({ url: candidateUrl, deadline }),
        ),
      );
      for (const icon of downloadedIcons)
        if (icon && (!bestIcon || icon.size > bestIcon.size)) bestIcon = icon;
      // No raster can outrank a scalable image; finish after the current batch has settled.
      if (bestIcon?.size === Infinity) break;
    }
    return bestIcon;
  }
}

export const webappIcon = new WebappIcon();
