import { chmod } from "node:fs/promises";
import { buildExtension } from "../../../packages/better-whatsapp-web/src/build.ts";
import { buildBrowserLinks } from "../../../packages/luna-browser-links/src/build.ts";
import { browserLinkConfigSchema } from "../../../packages/luna-api/src/modules/webapp/browser-links.ts";
import { HOST } from "../../../packages/luna-browser-links/src/rules.ts";

function idForPath(path: string) {
  return new Bun.CryptoHasher("sha256")
    .update(path)
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/gu, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
}
function quote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

/** Stage complete builds before setup replaces any installed local extension. */
export async function prepareLocalExtensions({
  stage,
  profileRoot,
  extraOrigins,
}: {
  stage: string;
  profileRoot: string;
  extraOrigins: string[];
}) {
  const home = Bun.env.HOME!;
  const data =
    Bun.env.LUNA_DATA_HOME_DIR || `${Bun.env.XDG_DATA_HOME || `${home}/.local/share`}/luna`;
  const items = ["better-whatsapp-web", "browser-links"].map((name) => {
    const directory = `${profileRoot}/Luna/Luna/extensions/${name}`;
    return { name, source: `${stage}/${name}`, directory, id: idForPath(directory) };
  });
  const whatsapp = items[0]!;
  const links = items[1]!;
  await buildExtension(whatsapp.source);
  await buildBrowserLinks(links.source, links.id);
  const config = browserLinkConfigSchema.parse({
    dataDir: `${data}/webapps`,
    profileRoot,
    extensionId: links.id,
    extraOrigins,
  });
  await Bun.write(`${links.source}/native/config.jsonc`, JSON.stringify(config, null, 2) + "\n");
  await Bun.write(
    `${links.source}/native/host`,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(`${links.directory}/native/native.js`)} "$@"\n`,
  );
  await chmod(`${links.source}/native/host`, 0o700);
  return {
    items,
    host: {
      path: `${profileRoot}/NativeMessagingHosts/${HOST}.json`,
      manifest: {
        name: HOST,
        description: "Open Luna browser links in the default browser",
        type: "stdio",
        path: `${links.directory}/native/host`,
        allowed_origins: [`chrome-extension://${links.id}/`],
      },
    },
  };
}
