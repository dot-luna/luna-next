import { join } from "pathe";
import { metadata, readOptional, writeFile } from "../lib/files.ts";
import { ordinaryParents } from "../lib/paths.ts";
import { ApiError } from "../lib/response.ts";
import type { InstallContext } from "../self/install/command.ts";
import type { CatalogApp } from "./catalog.ts";

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** Publish this app's Zsh aliases without touching other apps or personal startup files. */
export async function configureAliases(context: InstallContext, app: CatalogApp) {
  // Keep these outside zsh/: configuring that app replaces its exported modules.
  const file = join(context.env.LUNA_CONFIG_HOME_DIR!, "aliases", `${app.id}.zsh`);
  await ordinaryParents(file);
  const info = await metadata(file);
  if (info && !info.isFile())
    throw new ApiError("INVALID_PATH", `App aliases must be an ordinary file: ${file}`);
  const previous = await readOptional(file);
  const aliases = app.manifest.alias ?? [];
  if (!aliases.length && previous === null) return;

  const contents = aliases
    .map((alias) => {
      const [name, argv] = typeof alias === "string" ? [alias, [app.manifest.name]] : alias;
      const command = argv.map(quote).join(" ");
      return (
        `if (( ! $+aliases[${name}] && ! $+functions[${name}] )); then\n` +
        `    alias -- ${quote(`${name}=${command}`)}\n` +
        "fi\n"
      );
    })
    .join("");
  await writeFile(file, contents, previous);
}
