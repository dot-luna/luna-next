import { isAbsolute, join, resolve } from "pathe";
import { readDocument } from "../lib/files.ts";
import { ApiError } from "../lib/response.ts";
import type { ScreenshotContext, ScreenshotTextOptions } from "./context.ts";
import { screenshotSettingsSchema } from "./schema.ts";

export async function textSettings(context: ScreenshotContext, options: ScreenshotTextOptions) {
  const { env } = context;
  const home =
    env.LUNA_CONFIG_HOME_DIR ||
    (env.XDG_CONFIG_HOME
      ? join(env.XDG_CONFIG_HOME, "luna")
      : env.HOME
        ? join(env.HOME, ".config/luna")
        : undefined);
  if (home && !isAbsolute(home))
    throw new ApiError("INVALID_PATH", "Screenshot configuration home must be absolute");
  const file = options.configFile ?? (home ? join(home, "screenshot.jsonc") : undefined);
  // oxlint-disable-next-line no-control-regex
  if (!file || /[\x00-\x1f\x7f]/u.test(file) || resolve(file) === "/")
    throw new ApiError("INVALID_PATH", "Set a screenshot config file or HOME");
  const document = await readDocument(resolve(file));
  const parsed = screenshotSettingsSchema.safeParse(document.value);
  if (!parsed.success)
    throw new ApiError("INVALID_METADATA", `Invalid screenshot settings: ${parsed.error.message}`);
  return {
    layout: parsed.data.text?.layout ?? "block",
    preserve_spaces: parsed.data.text?.preserve_spaces ?? false,
  };
}
