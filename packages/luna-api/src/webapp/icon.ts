import { webappManifestSchema, webappUrlSchema } from "./schema.ts";

export const iconExtensions = ["png", "svg", "ico", "jpeg", "webp", "gif", "bmp"] as const;
type IconExtension = (typeof iconExtensions)[number];
type WebsiteIcon = { bytes: Buffer; extension: IconExtension; size: number };

function httpUrl(value: string, base: string) {
  try {
    const parsed = webappUrlSchema.safeParse(new URL(value, base).href);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Bound redirects, response bodies and elapsed time, including sites that never finish streaming. */
async function download(url: string, deadline: AbortSignal, limit: number) {
  const signal = AbortSignal.any([deadline, AbortSignal.timeout(5000)]);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(url, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      const next = location && httpUrl(location, url);
      if (!next) return;
      url = next;
      continue;
    }
    if (!response.ok || Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel();
      return;
    }
    if (!response.body) return;
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return { url, bytes: Buffer.concat(chunks, length) };
        length += value.length;
        if (length > limit) return;
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
  }
}

async function image(bytes: Buffer): Promise<WebsiteIcon | undefined> {
  const text = bytes.toString("utf8");
  // SVG is scalable; keep its source rather than rasterizing it at a fixed desktop size.
  if (/^\s*(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/iu.test(text))
    return { bytes, extension: "svg", size: Infinity };
  if (bytes.length >= 6 && bytes.readUInt32LE(0) === 0x10000) {
    const count = bytes.readUInt16LE(4);
    if (!count || bytes.length < 6 + count * 16) return;
    let size = 0;
    for (let index = 0; index < count; index++) {
      const offset = 6 + index * 16;
      const length = bytes.readUInt32LE(offset + 8);
      const start = bytes.readUInt32LE(offset + 12);
      if (!length || start < 6 + count * 16 || start + length > bytes.length) return;
      size = Math.max(size, Math.min(bytes[offset] || 256, bytes[offset + 1] || 256));
    }
    return { bytes, extension: "ico", size };
  }
  try {
    const { width, height, format } = await new Bun.Image(bytes, {
      maxPixels: 4096 * 4096,
    }).metadata();
    const extension = iconExtensions.find((value) => value === format);
    if (extension && width > 0 && height > 0)
      return { bytes, extension, size: Math.min(width, height) };
  } catch {
    // A successful HTTP response can contain a login page or an unsupported image format.
  }
}

/** Find the largest usable site icon and retain its original bytes. Network failures are optional. */
export async function websiteIcon(url: string): Promise<WebsiteIcon | undefined> {
  const deadline = AbortSignal.timeout(15000);
  const candidates = new Set<string>();
  const add = (value: string, base: string) => {
    const candidate = httpUrl(value, base);
    if (candidate && candidates.size < 24) candidates.add(candidate);
  };
  let pageUrl = url;
  try {
    const page = await download(url, deadline, 2 * 1024 * 1024);
    if (page) {
      pageUrl = page.url;
      let base = page.url;
      let baseFound = false;
      const links: { rel: string[]; href: string }[] = [];
      new HTMLRewriter()
        .on("base[href]", {
          element(element) {
            if (baseFound) return;
            baseFound = true;
            base = httpUrl(element.getAttribute("href")!, page.url) || page.url;
          },
        })
        .on("link[href][rel]", {
          element(element) {
            links.push({
              rel: element.getAttribute("rel")!.toLowerCase().split(/\s+/u),
              href: element.getAttribute("href")!,
            });
          },
        })
        .transform(page.bytes.toString("utf8"));
      const manifestLink = links.find((link) => link.rel.includes("manifest"));
      const manifestUrl = manifestLink && httpUrl(manifestLink.href, base);
      if (manifestUrl) {
        try {
          const manifest = await download(manifestUrl, deadline, 2 * 1024 * 1024);
          if (manifest) {
            const parsed = webappManifestSchema.safeParse(
              JSON.parse(manifest.bytes.toString("utf8")),
            );
            if (parsed.success)
              for (const icon of parsed.data.icons)
                if (
                  icon &&
                  (!icon.purpose ||
                    icon.purpose
                      .split(/\s+/u)
                      .some((purpose) => ["any", "maskable"].includes(purpose)))
                )
                  add(icon.src, manifest.url);
          }
        } catch {
          // Broken manifests must not discard usable icons declared by the page.
        }
      }
      for (const link of links)
        if (
          link.rel.some((rel) =>
            ["icon", "apple-touch-icon", "apple-touch-icon-precomposed"].includes(rel),
          )
        )
          add(link.href, base);
    }
  } catch {
    // The conventional favicon may still work when the page cannot be retrieved.
  }
  add("/favicon.ico", pageUrl);
  let best: WebsiteIcon | undefined;
  const urls = [...candidates];
  // Limit concurrent requests while comparing actual dimensions, including icons without sizes metadata.
  for (let start = 0; start < urls.length && !deadline.aborted; start += 4) {
    const icons = await Promise.all(
      urls.slice(start, start + 4).map(async (candidate) => {
        try {
          const response = await download(candidate, deadline, 8 * 1024 * 1024);
          return response && (await image(response.bytes));
        } catch {
          return undefined;
        }
      }),
    );
    for (const icon of icons) if (icon && (!best || icon.size > best.size)) best = icon;
    if (best?.size === Infinity) break;
  }
  return best;
}
