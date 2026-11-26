import { copyFile, mkdir, mkdtemp, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "pathe";
import { metadata, readDocument, writeFile } from "@/lib/files.ts";
import { copyTree } from "@/lib/tree.ts";
import { canonicalPath, hasControlCharacters, overlaps, ordinaryParents } from "@/lib/paths.ts";
import { capture } from "@/lib/process.ts";
import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import { environment } from "@/lib/env.ts";
import { loginDefaults } from "./defaults.ts";
import { loginSettingsSchema } from "./schema.ts";

export interface BuildLoginOptions {
  configFile: string;
  /** Directory containing greeter/ and the bundled screens/. */
  sourceDirectory: string;
  output: string;
  env?: Record<string, string>;
}

/**
 * Prepare a portable SDDM theme from one JSONC read. Relative inputs resolve beside
 * the config; screen sources stay untouched. Replace only the requested output.
 */
export async function buildLogin({
  configFile,
  sourceDirectory,
  output,
  env: suppliedEnv,
}: BuildLoginOptions) {
  const env = environment(suppliedEnv);
  if (!output || hasControlCharacters(output) || resolve(output) === "/")
    throw new ApiError("INVALID_PATH", "Choose an output directory other than the filesystem root");
  const config = resolve(configFile);
  const source = await realpath(sourceDirectory);
  const destination = resolve(output);
  await ordinaryParents(destination);
  const actual = await canonicalPath(destination);
  // Check before missing-file creation so an invalid output cannot consume its config.
  for (const input of [source, await canonicalPath(config)])
    if (overlaps(actual, input))
      throw new ApiError("INVALID_PATH", "Login output cannot overlap its sources or config");
  const document = await readDocument(config);
  const settings = validate(loginSettingsSchema, document.value, config);
  const screen = await realpath(
    settings.screen?.path
      ? resolve(dirname(config), settings.screen.path)
      : join(source, "screens/default"),
  );
  if (!(await stat(join(screen, "Screen.qml"))).isFile())
    throw new ApiError("INVALID_PATH", "The screen folder must contain Screen.qml");
  const image = settings.background?.path
    ? await realpath(resolve(dirname(config), settings.background.path))
    : undefined;
  for (const input of [screen, ...(image ? [image] : [])])
    if (overlaps(actual, input))
      throw new ApiError("INVALID_PATH", "Login output cannot overlap its screen or image");
  if (image) {
    if (!(await stat(image)).isFile())
      throw new ApiError("INVALID_PATH", "The background must be an image file");
    const result = await capture({ args: ["file", "--brief", "--mime-type", "--", image], env });
    if (result.code !== 0) throw new ApiError("COMMAND_FAILED", result.stderr || result.stdout);
    if (!result.stdout.trim().startsWith("image/"))
      throw new ApiError("INVALID_ARGUMENT", "Only image backgrounds are supported");
  }
  const existing = await metadata(destination);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
    throw new ApiError("INVALID_PATH", "Login output must be an ordinary directory");
  await mkdir(dirname(destination), { recursive: true });
  const stage = await mkdtemp(join(dirname(destination), ".luna-login-"));
  try {
    const bundle = join(stage, "theme");
    await copyTree(join(source, "greeter"), bundle, source);
    await copyTree(screen, join(bundle, "screen"), screen);
    let background = "";
    if (image) {
      await mkdir(join(bundle, "assets"));
      background = "assets/background" + extname(image);
      await copyFile(image, join(bundle, background));
    }
    const snapshot = {
      screen: { path: "screen" },
      theme: {
        colors: { ...loginDefaults.theme.colors, ...settings.theme?.colors },
        fonts: { ...loginDefaults.theme.fonts, ...settings.theme?.fonts },
        appearance: {
          rounding: settings.theme?.appearance?.rounding ?? loginDefaults.theme.appearance.rounding,
          blur: { ...loginDefaults.theme.appearance.blur, ...settings.theme?.appearance?.blur },
        },
      },
      background: { path: background },
      actions: {
        shutdown_delay: settings.actions?.shutdown_delay ?? loginDefaults.actions.shutdown_delay,
      },
      login: { user: settings.login?.user ?? null },
    };
    await writeFile(
      join(bundle, "Settings.js"),
      ".pragma library\nvar values = " + JSON.stringify(snapshot) + ";\n",
      null,
    );
    if (existing) {
      const result = await capture({
        args: ["mv", "--exchange", "--no-copy", "--no-target-directory", "--", bundle, destination],
        env,
      });
      if (result.code !== 0) throw new ApiError("COMMAND_FAILED", result.stderr || result.stdout);
    } else await rename(bundle, destination);
    return destination;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
