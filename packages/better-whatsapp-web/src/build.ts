import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

/** Build a standalone MV3 extension; callers own publication into the Chromium profile. */
export async function buildExtension(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const result = await Bun.build({
    entrypoints: [new URL("./content.ts", import.meta.url).pathname],
    outdir: directory,
    target: "browser",
    format: "iife",
    minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, "Cannot build Better WhatsApp Web");
  await Bun.write(
    `${directory}/manifest.json`,
    JSON.stringify(
      {
        manifest_version: 3,
        name: "Luna Better WhatsApp Web",
        version: "0.1.0",
        description:
          "Resize the chat list, adjust message text, and navigate unread conversations.",
        permissions: ["storage"],
        content_scripts: [
          { matches: ["https://web.whatsapp.com/*"], js: ["content.js"], run_at: "document_idle" },
        ],
      },
      null,
      2,
    ) + "\n",
  );
}

if (import.meta.main) await buildExtension(resolve(import.meta.dir, "../dist"));
