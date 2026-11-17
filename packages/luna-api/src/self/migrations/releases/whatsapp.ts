import { readdir, rm } from "node:fs/promises";
import { join } from "pathe";
import { appContext, type AppOptions } from "../../../apps/context.ts";
import { closeApp } from "../../../apps/processes.ts";
import { webapp } from "../../../modules/webapp/index.ts";
import { locked, metadata, readOptional, writeFile } from "../../../lib/files.ts";
import { ordinaryParents } from "../../../lib/paths.ts";
import { ApiError } from "../../../lib/response.ts";
import { removeWhatlyDependencies } from "./whatly-dependencies.ts";
import { whatlyPaths } from "./whatly-paths.ts";

/** Remove only the retired desktop ID from shared MIME associations, retaining other handlers. */
function withoutWhatly(source: string) {
  return source
    .split("\n")
    .flatMap((line) => {
      if (!line.includes("=") || /^\s*[#;]/u.test(line)) return [line];
      const index = line.indexOf("=");
      const values = line.slice(index + 1).split(";");
      const keep = values.filter((value) => value.trim() !== "net.shakaran.whatly.desktop");
      if (keep.length === values.length) return [line];
      if (!keep.some((value) => value.trim())) return [];
      return [line.slice(0, index + 1) + keep.join(";")];
    })
    .join("\n");
}

/** Install WhatsApp before retiring Whatly. Cleanup is destructive and safe to repeat after failure. */
export async function replaceWhatly(options: AppOptions = {}) {
  const context = await appContext(options);
  const appState = join(context.env.LUNA_STATE_HOME_DIR!, "apps/whatly.jsonc");
  await ordinaryParents(appState);
  const lock = await metadata(appState + ".lock");
  if (lock && !lock.isFile())
    throw new ApiError("INVALID_PATH", "Invalid Whatly installation lock");
  return locked({ configFile: appState, env: context.env }, async () => {
    await whatlyPaths(context); // Refuse unsafe cleanup paths before any application writes.
    context.progress("Installing WhatsApp web app...");
    const installed = await webapp.install("WhatsApp", "https://web.whatsapp.com/", {
      env: context.env,
    });
    if (!installed.succes) throw new ApiError(installed.err, installed.errMessage);
    await closeApp(context, {
      id: "whatly",
      directory: context.repository,
      manifest: {
        name: "whatly",
        source: "git",
        url: "https://github.com/dot-luna/whatly.git",
        processes: ["whatly"],
      },
    });
    // Closing Whatly may save settings. Re-read them before enumerating custom storage.
    const plan = await whatlyPaths(context);
    const associations = [];
    for (const directory of [
      context.env.XDG_CONFIG_HOME!,
      join(context.env.XDG_DATA_HOME!, "applications"),
    ]) {
      // Desktop-specific lists follow the same freedesktop naming convention.
      await ordinaryParents(join(directory, "entry"));
      for (const name of (await metadata(directory)) ? await readdir(directory) : []) {
        if (name !== "mimeapps.list" && !name.endsWith("-mimeapps.list")) continue;
        const path = join(directory, name);
        if (!(await metadata(path))?.isFile())
          throw new ApiError("INVALID_PATH", `MIME associations must be a regular file: ${path}`);
        const source = (await readOptional(path))!;
        associations.push({ path, source, next: withoutWhatly(source) });
      }
    }
    for (const path of plan.paths) await ordinaryParents(path);
    context.progress("Removing Whatly and all its profiles, sessions, settings and caches...");
    // Keep settings until custom storage is removed, so an interrupted retry can find it again.
    const ordered = [
      ...plan.paths.filter((path) => !plan.settings.has(path)),
      ...plan.settings.keys(),
    ];
    for (const path of ordered) {
      await ordinaryParents(path);
      if (plan.settings.has(path) && (await readOptional(path)) !== plan.settings.get(path))
        throw new ApiError("CONFLICT", `Whatly settings changed during cleanup: ${path}`);
      await rm(path, { recursive: true, force: true });
    }
    for (const item of associations)
      if (item.next !== item.source) await writeFile(item.path, item.next, item.source);
    if (Bun.which("update-desktop-database", { PATH: context.env.PATH }))
      await context.execute([
        "update-desktop-database",
        join(context.env.XDG_DATA_HOME!, "applications"),
      ]);
    await removeWhatlyDependencies(context);
    return installed.data;
  });
}
