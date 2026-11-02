import { readdir, rm } from "node:fs/promises";
import { join } from "pathe";
import { ApiError, respond } from "../lib/response.ts";
import { desktopArgument } from "../lib/desktop.ts";
import { locked, metadata, parse, readOptional, writeFile } from "../lib/files.ts";
import { validate } from "../lib/validation.ts";
import {
  requireProfile,
  validatePaths,
  webappContext,
  type WebappContext,
  type WebappOptions,
} from "./context.ts";
import {
  webappNameSchema,
  webappRecipeSchema,
  webappRecordSchema,
  type WebappRecord,
} from "./schema.ts";

const idFor = (name: string) => `luna-webapp-${Buffer.from(name, "utf8").toString("hex")}`;

async function ordinary(path: string) {
  let current = "";
  for (const part of path.split("/").filter(Boolean)) {
    current += "/" + part;
    const value = await metadata(current);
    if (value && (value.isSymbolicLink() || (!value.isFile() && !value.isDirectory())))
      throw new ApiError("INVALID_PATH", `Web app exports must be ordinary paths: ${current}`);
  }
}

async function readApp(context: WebappContext, value: string, byId = false) {
  const id = byId ? value : idFor(validate(webappNameSchema, value, "Web app name"));
  const path = join(context.dataDir, id, "app.jsonc");
  await ordinary(join(context.dataDir, id));
  await ordinary(path);
  const source = await readOptional(path);
  if (source === null) throw new ApiError("INVALID_ARGUMENT", `Web app is not installed: ${value}`);
  const app = validate(webappRecordSchema, parse(source, path), path);
  if (app.id !== id || idFor(app.name) !== id)
    throw new ApiError(
      "INVALID_METADATA",
      "Web app metadata identity does not match its directory",
    );
  return app;
}

/** Install launch metadata and a desktop entry without opening a browser or changing its profile. */
export async function installWebapp(context: WebappContext, name: string, url: string) {
  const recipe = validate(webappRecipeSchema, { name, url }, "Web app");
  const browser = await requireProfile(context);
  const launcher = await metadata(context.launcher);
  if (!launcher?.isFile() || !(launcher.mode & 0o111))
    throw new ApiError("INVALID_PATH", "Install the Luna CLI before installing web apps");
  const app: WebappRecord = { ...recipe, id: idFor(recipe.name) };
  const directory = join(context.dataDir, app.id);
  const config = join(directory, "app.jsonc");
  const desktop = join(context.applicationsDir, `${app.id}.desktop`);
  await ordinary(context.dataDir);
  await ordinary(context.applicationsDir);
  await ordinary(directory);
  await ordinary(config);
  await ordinary(desktop);
  return locked({ configFile: config, env: context.env }, async () => {
    const source = await readOptional(config);
    const entry = await readOptional(desktop);
    const title = app.name.replaceAll("\\", "\\\\");
    // A constant shell command forwards data arguments, including executable paths with % or =.
    // Desktop sessions need not inherit the install process's environment or API overrides.
    const launchArgs = [
      "/usr/bin/bash",
      "-c",
      'exec "$@"',
      "luna-webapp",
      context.launcher,
      "webapp",
      "launch",
      app.name,
      "--data-dir",
      context.dataDir,
      "--applications-dir",
      context.applicationsDir,
      "--launcher",
      context.launcher,
      "--profile-root",
      context.profileRoot,
      "--chromium",
      browser,
    ];
    const body = [
      "[Desktop Entry]",
      "Type=Application",
      `Name=${title}`,
      `Exec=${launchArgs.map(desktopArgument).join(" ")}`,
      "Icon=chromium",
      "Terminal=false",
      "Categories=Network;",
      `StartupWMClass=${app.id}`,
      "",
    ].join("\n");
    await writeFile(config, JSON.stringify(app, null, 2) + "\n", source);
    await writeFile(desktop, body, entry);
    return { ...app, desktopFile: desktop };
  });
}

export const webapp = {
  install(name: string, url: string, options: WebappOptions = {}) {
    return respond(() => installWebapp(webappContext(options), name, url));
  },
  list(options: WebappOptions = {}) {
    return respond(async () => {
      const c = webappContext(options);
      if (!(await metadata(c.dataDir))) return [];
      const apps: WebappRecord[] = [];
      for (const entry of await readdir(c.dataDir, { withFileTypes: true }))
        if (
          entry.isDirectory() &&
          /^luna-webapp-[0-9a-f]+$/u.test(entry.name) &&
          (await metadata(join(c.dataDir, entry.name, "app.jsonc")))
        )
          apps.push(await readApp(c, entry.name, true));
      return apps.sort((a, b) => a.name.localeCompare(b.name));
    });
  },
  uninstall(name: string, options: WebappOptions = {}) {
    return respond(async () => {
      const c = webappContext(options);
      await validatePaths(c);
      const app = await readApp(c, name);
      const directory = join(c.dataDir, app.id);
      const config = join(directory, "app.jsonc");
      return locked({ configFile: config, env: c.env }, async () => {
        const desktop = join(c.applicationsDir, `${app.id}.desktop`);
        await ordinary(desktop);
        await rm(desktop, { force: true });
        // Keep the persistent lock inode; remove only the declared app metadata, never profile data.
        await rm(config);
        return app;
      });
    });
  },
  launch(name: string, options: WebappOptions = {}) {
    return respond(async () => {
      const c = webappContext(options);
      const app = await readApp(c, name);
      const browser = await requireProfile(c);
      const child = Bun.spawn(
        [
          browser,
          `--user-data-dir=${c.profileRoot}`,
          "--profile-directory=Luna",
          `--app=${app.url}`,
          `--class=${app.id}`,
          "--no-first-run",
          "--no-default-browser-check",
        ],
        { env: c.env, stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true },
      );
      child.unref();
      return { ...app, pid: child.pid };
    });
  },
};
