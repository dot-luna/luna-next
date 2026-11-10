import { mkdtemp, readdir, rename, rm, writeFile as writeBytes } from "node:fs/promises";
import { join } from "pathe";
import { ApiError, respond } from "@/lib/response.ts";
import { desktopArgument } from "@/lib/desktop.ts";
import { locked, metadata, parse, readOptional, writeFile } from "@/lib/files.ts";
import { validate } from "@/lib/validation.ts";
import { iconExtensions, webappIcon } from "./icon.ts";
import { webappLauncher, type WebappLaunchOptions } from "./launch.ts";
import { webappContext, type WebappContext, type WebappOptions } from "./context.ts";
import {
  webappLaunchSettingsSchema,
  webappNameSchema,
  webappRecipeSchema,
  webappRecordSchema,
  type WebappRecipe,
  type WebappRecord,
} from "./schema.ts";

export interface WebappInstallOptions extends WebappOptions {
  /** Local file or direct HTTP(S) image URL; omit to discover the website's icon. */
  icon?: string;
}

/** Manage web app exports; resolve options per call so the shared instance holds no user state. */
class Webapp {
  /** Encode a validated name as a stable directory and desktop-entry ID, preserving case. */
  private _createAppId(name: string) {
    return `luna-webapp-${Buffer.from(name, "utf8").toString("hex")}`;
  }

  /**
   * Check absolute export paths and their existing ancestors before reading or writing.
   * Missing components are allowed; symlinks and special files raise INVALID_PATH.
   * These checks inspect current paths; they do not lock out external filesystem changes.
   */
  private async _assertOrdinaryPaths(...paths: string[]) {
    for (const path of paths) {
      let ancestorPath = "";
      for (const segment of path.split("/").filter(Boolean)) {
        ancestorPath += "/" + segment;
        const pathMetadata = await metadata(ancestorPath);
        if (
          pathMetadata &&
          (pathMetadata.isSymbolicLink() || (!pathMetadata.isFile() && !pathMetadata.isDirectory()))
        )
          throw new ApiError("INVALID_PATH", `Web app exports must be ordinary paths: ${ancestorPath}`);
      }
    }
  }

  /**
   * Read saved metadata by display name, or by a prevalidated directory ID when isAppId is true.
   * Require the saved name and ID to match the directory. Missing apps raise
   * INVALID_ARGUMENT; malformed or mismatched metadata raises INVALID_METADATA.
   */
  private async _readInstalledApp(context: WebappContext, nameOrId: string, isAppId = false) {
    const appId = isAppId
      ? nameOrId
      : this._createAppId(validate(webappNameSchema, nameOrId, "Web app name"));
    const metadataPath = join(context.dataDir, appId, "app.jsonc");
    await this._assertOrdinaryPaths(join(context.dataDir, appId), metadataPath);
    const metadataSource = await readOptional(metadataPath);
    if (metadataSource === null)
      throw new ApiError("INVALID_ARGUMENT", `Web app is not installed: ${nameOrId}`);
    const app = validate(webappRecordSchema, parse(metadataSource, metadataPath), metadataPath);
    if (app.id !== appId || this._createAppId(app.name) !== appId)
      throw new ApiError(
        "INVALID_METADATA",
        "Web app metadata identity does not match its directory",
      );
    return app;
  }

  /** Read installed records in name order, ignoring directories left behind by uninstall. */
  private async _listInstalledApps(context: WebappContext) {
    if (!(await metadata(context.dataDir))) return [];
    const installedApps: WebappRecord[] = [];
    for (const directoryEntry of await readdir(context.dataDir, { withFileTypes: true })) {
      if (!directoryEntry.isDirectory() || !/^luna-webapp-[0-9a-f]+$/u.test(directoryEntry.name))
        continue;
      if (!(await metadata(join(context.dataDir, directoryEntry.name, "app.jsonc")))) continue;
      installedApps.push(await this._readInstalledApp(context, directoryEntry.name, true));
    }
    return installedApps.sort((firstApp, secondApp) => firstApp.name.localeCompare(secondApp.name));
  }

  /** Resolve an exact name without scanning unrelated apps; invoke fuzzy matching only if needed. */
  private async _resolveLaunchApp({
    context,
    query,
    fuzzy,
  }: {
    context: WebappContext;
    query: string;
    fuzzy: boolean;
  }) {
    const exactMetadataPath = join(context.dataDir, this._createAppId(query), "app.jsonc");
    if (!fuzzy || (await metadata(exactMetadataPath))) return this._readInstalledApp(context, query);
    return webappLauncher.matchName({ context, query, apps: await this._listInstalledApps(context) });
  }

  /**
   * Copy an explicit icon or discover the site's best icon, returning its installed path.
   * Only discovery may return undefined for a generic icon; an invalid explicit source fails.
   * The caller must hold the app lock and create its directory before calling.
   */
  private async _installIcon({
    appDirectory,
    url,
    iconSource,
  }: {
    appDirectory: string;
    url: string;
    iconSource: string | undefined;
  }) {
    const selectedIcon =
      iconSource === undefined
        ? await webappIcon.downloadBest(url)
        : await webappIcon.load(iconSource);
    if (!selectedIcon) return;

    const iconPath = join(appDirectory, `icon.${selectedIcon.extension}`);
    await this._assertOrdinaryPaths(iconPath);
    // Stage beside the destination so rename publishes complete bytes on the same filesystem.
    const stagingDirectory = await mkdtemp(join(appDirectory, ".luna-icon-"));
    try {
      const stagedIconPath = join(stagingDirectory, "icon");
      await writeBytes(stagedIconPath, selectedIcon.bytes, { mode: 0o600 });
      await rename(stagedIconPath, iconPath);
    } finally {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
    return iconPath;
  }

  /** Build a desktop entry that retains the install-time paths and browser executable. */
  private _buildDesktopEntry({
    context,
    app,
    browserExecutable,
    iconPath,
  }: {
    context: WebappContext;
    app: WebappRecord;
    browserExecutable: string;
    iconPath: string | undefined;
  }) {
    // Forward values as arguments to a fixed command; names and paths never become shell code.
    // The desktop session need not inherit the installer’s environment or API overrides.
    const launcherArguments = [
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
      browserExecutable,
    ];
    // Name and Icon are desktop strings; Exec additionally needs argument and field-code escaping.
    return [
      "[Desktop Entry]",
      "Type=Application",
      `Name=${app.name.replaceAll("\\", "\\\\")}`,
      `Exec=${launcherArguments.map(desktopArgument).join(" ")}`,
      `Icon=${iconPath ? iconPath.replaceAll("\\", "\\\\") : "applications-internet"}`,
      "Terminal=false",
      "Categories=Network;",
      `StartupWMClass=${app.id}`,
      "",
    ].join("\n");
  }

  /**
   * Install or update a named HTTP(S) app using an already-resolved context.
   * Require Chromium, its configured Luna profile, and an executable Luna launcher.
   * Save metadata, a desktop entry, and an optional site icon without opening or
   * modifying the browser profile. An explicit icon is copied or downloaded;
   * without one, discover a site icon and use a generic icon if none is available.
   * Return the app record and desktop-file path; throw failures for setup callers.
   * Writes are separate, so a later failure can leave earlier writes in place.
   */
  async installWithContext(context: WebappContext, recipe: WebappRecipe) {
    const validatedApp = validate(webappRecipeSchema, recipe, "Web app");
    const browserExecutable = await webappContext.requireConfiguredBrowser(context);
    const launcherMetadata = await metadata(context.launcher);
    if (!launcherMetadata?.isFile() || !(launcherMetadata.mode & 0o111))
      throw new ApiError("INVALID_PATH", "Install the Luna CLI before installing web apps");
    // The installed copy must remain usable after the original icon moves or disappears.
    const app: WebappRecord = {
      name: validatedApp.name,
      url: validatedApp.url,
      id: this._createAppId(validatedApp.name),
    };
    const appDirectory = join(context.dataDir, app.id);
    const metadataPath = join(appDirectory, "app.jsonc");
    const desktopEntryPath = join(context.applicationsDir, `${app.id}.desktop`);
    const iconPaths = iconExtensions.map((extension) => join(appDirectory, `icon.${extension}`));
    // Reject unsafe destinations before the lock creates directories or installation writes files.
    await this._assertOrdinaryPaths(
      context.dataDir,
      context.applicationsDir,
      appDirectory,
      metadataPath,
      desktopEntryPath,
      ...iconPaths,
    );
    return locked({ configFile: metadataPath, env: context.env }, async () => {
      // Capture both files under the app lock; writes reject detected edits made outside the lock.
      const previousMetadata = await readOptional(metadataPath);
      const previousDesktopEntry = await readOptional(desktopEntryPath);
      const installedIconPath = await this._installIcon({
        appDirectory,
        url: app.url,
        iconSource: validatedApp.icon,
      });
      const desktopEntryContents = this._buildDesktopEntry({
        context,
        app,
        browserExecutable,
        iconPath: installedIconPath,
      });
      await writeFile(metadataPath, JSON.stringify(app, null, 2) + "\n", previousMetadata);
      await writeFile(desktopEntryPath, desktopEntryContents, previousDesktopEntry);
      // Retire old formats only after the desktop entry points at the new icon or generic fallback.
      for (const iconPath of iconPaths)
        if (iconPath !== installedIconPath) await rm(iconPath, { force: true });
      return { ...app, desktopFile: desktopEntryPath };
    });
  }

  /**
   * Resolve paths and environment from options, then install or update the named app.
   * options.icon selects a local file or direct HTTP(S) URL; omitted icons are discovered.
   * Wrap installWithContext's result or failure in Luna's standard API response.
   */
  install(name: string, url: string, options: WebappInstallOptions = {}) {
    return respond(() =>
      this.installWithContext(webappContext.resolve(options), {
        name,
        url,
        icon: options.icon,
      }),
    );
  }

  /**
   * Return installed app records sorted by display name in an API response.
   * A missing library returns an empty list; directories without metadata are skipped.
   * Invalid metadata fails the request instead of returning a partial list.
   */
  list(options: WebappOptions = {}) {
    return respond(() => this._listInstalledApps(webappContext.resolve(options)));
  }

  /**
   * Remove the named app's desktop entry, metadata, and supported icon files.
   * Retain browser data, unrelated files, and the app's lock file and directory.
   * Return the removed record in an API response; a missing app is INVALID_ARGUMENT.
   * Deletions are separate and are not rolled back if a later deletion fails.
   */
  uninstall(name: string, options: WebappOptions = {}) {
    return respond(async () => {
      const context = webappContext.resolve(options);
      await webappContext.validateExportPaths(context);
      const app = await this._readInstalledApp(context, name);
      const appDirectory = join(context.dataDir, app.id);
      const metadataPath = join(appDirectory, "app.jsonc");
      return locked({ configFile: metadataPath, env: context.env }, async () => {
        const desktopEntryPath = join(context.applicationsDir, `${app.id}.desktop`);
        const iconPaths = iconExtensions.map((extension) => join(appDirectory, `icon.${extension}`));
        await this._assertOrdinaryPaths(desktopEntryPath, ...iconPaths);
        await rm(desktopEntryPath, { force: true });
        // Keep the persistent lock inode; remove only declared app files, never profile data.
        await rm(metadataPath);
        for (const iconPath of iconPaths) await rm(iconPath, { force: true });
        return app;
      });
    });
  }

  /**
   * Launch by exact name first, otherwise use fzf's best fuzzy match without a picker.
   * Focus an existing Hyprland window by default; focusExisting=false opens a new one.
   * Set fuzzy=false to require the exact saved name. Return the app record, PID, and
   * action (focused or opened); focused results also include the window address.
   */
  launch(name: string, options: WebappLaunchOptions = {}) {
    return respond(async () => {
      const context = webappContext.resolve(options);
      const settings = validate(webappLaunchSettingsSchema, options, "Web app launch options");
      const query = validate(webappNameSchema, name, "Web app name");
      const app = await this._resolveLaunchApp({ context, query, fuzzy: settings.fuzzy });
      return webappLauncher.launch({ context, app, focusExisting: settings.focusExisting });
    });
  }

}

export const webapp = new Webapp();
