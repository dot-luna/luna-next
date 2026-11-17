import {
  browserLinkConfigSchema,
  routeBrowserLink,
} from "../../luna-api/src/modules/webapp/browser-links.ts";
import { readMessage, encodeMessage } from "./protocol.ts";

/** stdout belongs exclusively to Chromium's framed protocol. Diagnostics are returned as data. */
async function main() {
  const config = browserLinkConfigSchema.parse(
    Bun.JSONC.parse(await Bun.file(new URL("./config.jsonc", import.meta.url)).text()),
  );
  if (Bun.argv[2] !== `chrome-extension://${config.extensionId}/`)
    throw new Error("Unrecognized extension origin");
  return routeBrowserLink({
    config,
    request: await readMessage(Bun.stdin.stream()),
    env: { ...Bun.env } as Record<string, string>,
  });
}
await Bun.write(
  Bun.stdout,
  encodeMessage(await main().catch((error) => ({ error: error.message || String(error) }))),
);
