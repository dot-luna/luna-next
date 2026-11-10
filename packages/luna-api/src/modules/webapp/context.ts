import { isAbsolute, join, resolve } from "pathe";
import { z } from "zod";
import { ApiError } from "@/lib/response.ts";
import { canonicalPath, overlaps } from "@/lib/paths.ts";
import { metadata } from "@/lib/files.ts";

/** Override web app locations and browser selection for one operation. */
export interface WebappOptions {
  /** Replace the process environment entirely; callers must include an absolute, non-root HOME. */
  env?: Record<string, string>;
  /** Directory containing installed app metadata and icons. */
  dataDir?: string;
  /** Destination directory for generated desktop entries. */
  applicationsDir?: string;
  /** Absolute path to the Luna executable used by desktop entries. */
  launcher?: string;
  /** Chromium user-data directory containing the configured Luna profile. */
  profileRoot?: string;
  /** Browser executable name or path, resolved against the selected environment's PATH. */
  chromium?: string;
}

/** Resolve fresh settings per operation; the shared resolver keeps no environment or path cache. */
class WebappContextResolver {
  /** Normalize an absolute destination, rejecting filesystem root and control characters. */
  private _resolveExportPath(path: string) {
    // oxlint-disable-next-line no-control-regex
    if (!isAbsolute(path) || resolve(path) === "/" || /[\x00-\x1f\x7f]/u.test(path))
      throw new ApiError("INVALID_PATH", "Web app paths must be absolute non-root paths");
    return resolve(path);
  }

  /** Reject exports inside, around, or equal to the browser profile root. */
  private _assertProfileSeparation({
    exportPath,
    profileRoot,
  }: {
    exportPath: string;
    profileRoot: string;
  }) {
    if (overlaps(profileRoot, exportPath))
      throw new ApiError("INVALID_PATH", "Web app exports must not overlap Chromium profile data");
  }

  /**
   * Copy the selected environment and resolve paths without reading or creating files.
   * Nonempty explicit paths override environment settings, then home-directory defaults.
   * Reject invalid HOME, unsafe destinations, and lexical overlap with the profile root.
   * Operations that touch exports must also resolve filesystem aliases with validateExportPaths.
   */
  resolve(options: WebappOptions = {}) {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(options.env ?? Bun.env))
      if (value !== undefined) env[name] = value;
    const homeDirectory = env.HOME;
    if (!homeDirectory || !isAbsolute(homeDirectory) || resolve(homeDirectory) === "/")
      throw new ApiError("INVALID_PATH", "HOME must be an absolute user home");

    const configDirectory = env.XDG_CONFIG_HOME || join(homeDirectory, ".config");
    const dataDirectory = env.XDG_DATA_HOME || join(homeDirectory, ".local/share");
    const profileRoot = this._resolveExportPath(
      options.profileRoot ||
        env.CHROME_USER_DATA_DIR ||
        join(env.CHROME_CONFIG_HOME || configDirectory, "chromium"),
    );
    const dataDir = this._resolveExportPath(
      options.dataDir || join(env.LUNA_DATA_HOME_DIR || join(dataDirectory, "luna"), "webapps"),
    );
    const applicationsDir = this._resolveExportPath(
      options.applicationsDir || join(dataDirectory, "applications"),
    );
    const launcher = this._resolveExportPath(options.launcher || join(homeDirectory, ".local/bin/luna"));
    for (const exportPath of [dataDir, applicationsDir, launcher])
      this._assertProfileSeparation({ exportPath, profileRoot });

    return {
      env,
      dataDir,
      applicationsDir,
      launcher,
      profileRoot,
      chromium: options.chromium || "chromium",
    };
  }

  /**
   * Resolve symlinks before checking export destinations against Chromium profile data.
   * Existing ancestors are resolved even for missing destinations, preventing aliases
   * from hiding an overlap. Throw INVALID_PATH for overlap without creating any files.
   */
  async validateExportPaths(context: WebappContext) {
    const profileRoot = await canonicalPath(context.profileRoot);
    for (const exportPath of [context.dataDir, context.applicationsDir, context.launcher]) {
      this._assertProfileSeparation({
        exportPath: await canonicalPath(exportPath),
        profileRoot,
      });
    }
  }

  /**
   * Validate export separation and require an existing Luna profile and browser executable.
   * Return the resolved executable path without opening Chromium or changing preferences.
   * Missing profile files raise INVALID_PATH, malformed preferences raise INVALID_METADATA,
   * and an unavailable browser raises INVALID_ENVIRONMENT.
   */
  async requireConfiguredBrowser(context: WebappContext) {
    await this.validateExportPaths(context);
    const preferencesPath = join(context.profileRoot, "Luna/Preferences");
    if (!(await metadata(preferencesPath))?.isFile())
      throw new ApiError(
        "INVALID_PATH",
        "Configure Luna's Chromium profile first: luna install chromium",
      );
    try {
      // Chromium owns this document; require a JSON object while accepting all native fields.
      z.record(z.string(), z.unknown()).parse(await Bun.file(preferencesPath).json());
    } catch {
      throw new ApiError("INVALID_METADATA", `Invalid Chromium preferences: ${preferencesPath}`);
    }
    const browserExecutable = Bun.which(context.chromium, { PATH: context.env.PATH });
    if (!browserExecutable)
      throw new ApiError("INVALID_ENVIRONMENT", "Chromium is required for web apps");
    return browserExecutable;
  }
}

export type WebappContext = ReturnType<WebappContextResolver["resolve"]>;
export const webappContext = new WebappContextResolver();
