import { isAbsolute, join, resolve } from "pathe";
import { ApiError } from "../lib/response.ts";
import { z } from "zod";
import { canonicalPath, overlaps } from "../lib/paths.ts";
import { metadata } from "../lib/files.ts";

export interface WebappOptions {
  env?: Record<string, string>;
  dataDir?: string;
  applicationsDir?: string;
  launcher?: string;
  profileRoot?: string;
  chromium?: string;
}

export function webappContext(options: WebappOptions = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? Bun.env))
    if (value !== undefined) env[key] = value;
  const home = env.HOME;
  if (!home || !isAbsolute(home) || resolve(home) === "/")
    throw new ApiError("INVALID_PATH", "HOME must be an absolute user home");
  const path = (value: string) => {
    // oxlint-disable-next-line no-control-regex
    if (!isAbsolute(value) || resolve(value) === "/" || /[\x00-\x1f\x7f]/u.test(value))
      throw new ApiError("INVALID_PATH", "Web app paths must be absolute non-root paths");
    return resolve(value);
  };
  const config = env.XDG_CONFIG_HOME || join(home, ".config");
  const data = env.XDG_DATA_HOME || join(home, ".local/share");
  const profileRoot = path(
    options.profileRoot ||
      env.CHROME_USER_DATA_DIR ||
      join(env.CHROME_CONFIG_HOME || config, "chromium"),
  );
  const dataDir = path(
    options.dataDir || join(env.LUNA_DATA_HOME_DIR || join(data, "luna"), "webapps"),
  );
  const applicationsDir = path(options.applicationsDir || join(data, "applications"));
  const launcher = path(options.launcher || join(home, ".local/bin/luna"));
  for (const target of [dataDir, applicationsDir, launcher]) {
    if (
      target === profileRoot ||
      target.startsWith(profileRoot + "/") ||
      profileRoot.startsWith(target + "/")
    )
      throw new ApiError("INVALID_PATH", "Web app exports must not overlap Chromium profile data");
  }
  return {
    env,
    dataDir,
    applicationsDir,
    launcher,
    profileRoot,
    chromium: options.chromium || "chromium",
  };
}
export type WebappContext = ReturnType<typeof webappContext>;

/** Resolve profile aliases before comparing against metadata and launcher destinations. */
export async function validatePaths(context: WebappContext) {
  const profile = await canonicalPath(context.profileRoot);
  for (const target of [context.dataDir, context.applicationsDir, context.launcher]) {
    if (overlaps(profile, await canonicalPath(target)))
      throw new ApiError("INVALID_PATH", "Web app exports must not overlap Chromium profile data");
  }
}

/** Web apps use the already-configured Luna profile; installation never creates a browser profile. */
export async function requireProfile(context: WebappContext) {
  await validatePaths(context);
  const preferences = join(context.profileRoot, "Luna/Preferences");
  if (!(await metadata(preferences))?.isFile())
    throw new ApiError(
      "INVALID_PATH",
      "Configure Luna's Chromium profile first: luna install chromium",
    );
  try {
    z.record(z.string(), z.unknown()).parse(await Bun.file(preferences).json());
  } catch {
    throw new ApiError("INVALID_METADATA", `Invalid Chromium preferences: ${preferences}`);
  }
  const executable = Bun.which(context.chromium, { PATH: context.env.PATH });
  if (!executable) throw new ApiError("INVALID_ENVIRONMENT", "Chromium is required for web apps");
  return executable;
}
