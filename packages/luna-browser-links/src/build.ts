import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { redirectRule } from "./rules.ts";

/** Build browser code separately from the Bun host, whose install-time config stays local. */
export async function buildBrowserLinks(directory: string, extensionId: string) {
  await mkdir(directory, { recursive: true });
  for (const [entries, target, outdir] of [
    [["background.ts", "open.ts"], "browser", directory],
    [["native.ts"], "bun", `${directory}/native`],
  ] as const) {
    const result = await Bun.build({
      entrypoints: entries.map((name) => new URL(name, import.meta.url).pathname),
      outdir,
      target,
      format: "esm",
    });
    if (!result.success) throw new AggregateError(result.logs, "Cannot build Luna Browser Links");
  }
  await Bun.write(
    `${directory}/manifest.json`,
    JSON.stringify(
      {
        manifest_version: 3,
        name: "Luna Browser Links",
        version: "0.1.0",
        description:
          "Open external links in the default browser and keep Luna web apps in Chromium.",
        permissions: ["nativeMessaging", "declarativeNetRequest"],
        host_permissions: ["http://*/*", "https://*/*"],
        background: { service_worker: "background.js", type: "module" },
        declarative_net_request: {
          rule_resources: [{ id: "external", enabled: true, path: "rules.json" }],
        },
        web_accessible_resources: [
          { resources: ["open.html"], matches: ["http://*/*", "https://*/*"] },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  await Bun.write(`${directory}/rules.json`, JSON.stringify([redirectRule(extensionId)]) + "\n");
  await Bun.write(
    `${directory}/open.html`,
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Open link</title>
    <style>:root{color-scheme:light dark}body{font:16px system-ui;max-width:36em;margin:48px auto;padding:24px}button{font:inherit;padding:8px 16px}</style>
    <p id="status" role="status">Opening link…</p><button id="retry" hidden>Retry</button><script type="module" src="open.js"></script></html>`,
  );
}

if (import.meta.main) {
  const directory = resolve(import.meta.dir, "../dist");
  const id = new Bun.CryptoHasher("sha256")
    .update(directory)
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/gu, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  await buildBrowserLinks(directory, id);
}
