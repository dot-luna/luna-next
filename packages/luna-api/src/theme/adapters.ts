import { join, resolve } from "pathe";
import { z } from "zod";
import { ApiError } from "../lib/response.ts";
import type { ThemeContext } from "./context.ts";
import { metadata, readOptional, writeFile } from "../lib/files.ts";
import { currentTheme } from "./selection.ts";
import { t3Colors } from "./t3-colors.ts";
import type { ResolvedTheme } from "./types.ts";

export function hyprlandTheme(theme: ResolvedTheme) {
  const a = theme.appearance;
  return {
    general: {
      gaps_in: a.gaps.inner,
      gaps_out: a.gaps.outer,
      border_size: a.border_width,
      col: { active_border: theme.colors.accent, inactive_border: theme.colors.muted },
    },
    decoration: {
      rounding: a.rounding,
      active_opacity: a.opacity.active,
      inactive_opacity: a.opacity.inactive,
      fullscreen_opacity: a.opacity.fullscreen,
      blur: a.blur,
      shadow: {
        enabled: a.shadow.enabled,
        range: a.shadow.range,
        render_power: a.shadow.falloff,
        color: `${theme.colors.dark_background}aa`,
        color_inactive: `${theme.colors.darker_background}66`,
      },
    },
  };
}

/** T3 reads its own native files; no app process is started or restarted by this adapter. */
export async function applyT3(context: ThemeContext, userdata?: string) {
  const base =
    context.env.T3CODE_HOME || (context.env.HOME ? join(context.env.HOME, ".t3") : undefined);
  if (!userdata && !base) throw new ApiError("INVALID_PATH", "Set T3CODE_HOME or HOME");
  const directory = resolve(userdata ?? join(base!, "userdata"));
  const paths = {
    theme: join(directory, "themes/luna.json"),
    client_settings: join(directory, "client-settings.json"),
    server_settings: join(directory, "settings.json"),
  };
  if ((await metadata(paths.theme))?.isSymbolicLink())
    throw new ApiError("INVALID_PATH", "Published T3 theme must not be a symlink");
  const docs = await Promise.all(
    Object.values(paths).map(async (path) => {
      const source = await readOptional(path);
      let value: unknown;
      try {
        value = source === null ? {} : JSON.parse(source);
      } catch {
        throw new ApiError("INVALID_METADATA", `Invalid T3 JSON: ${path}`);
      }
      const parsed = z.record(z.string(), z.unknown()).safeParse(value);
      if (!parsed.success)
        throw new ApiError("INVALID_METADATA", `T3 settings must be JSON objects: ${path}`);
      return { path, source, value: parsed.data };
    }),
  );
  const [palette, client, server] = docs as [
    (typeof docs)[number],
    (typeof docs)[number],
    (typeof docs)[number],
  ];
  if (Object.hasOwn(client.value, "settings"))
    throw new ApiError("INVALID_METADATA", "T3 client settings must use the current flat format");
  const theme = await currentTheme(context);
  const colors = Object.fromEntries(
    Object.entries(t3Colors).map(([native, role]) => [native, theme.colors[role]]),
  );
  const value = {
    version: 1,
    name: "Luna",
    appearance: theme.colors.mode,
    canvas: theme.colors.background,
    accent: theme.colors.accent,
    colors,
  };
  if (
    JSON.stringify(palette.value) !== JSON.stringify(value) ||
    server.value.defaultTheme !== "luna"
  ) {
    server.value.defaultTheme = "luna";
    server.value.defaultThemeSetAt = (
      BigInt(Date.now()) * 1_000_000n +
      (process.hrtime.bigint() % 1_000_000n)
    ).toString();
  }
  palette.value = value;
  Object.assign(client.value, {
    fontFamilySans: theme.fonts.ui,
    fontFamilyComposer: theme.fonts.ui,
    fontFamilyCode: theme.fonts.mono,
    fontFamilyTerminal: theme.fonts.mono,
    mathRenderingEnabled: true,
  });
  // Validate every original before the first publication; each write also checks again.
  for (const doc of docs)
    if ((await readOptional(doc.path)) !== doc.source)
      throw new ApiError("CONFLICT", `T3 settings changed externally: ${doc.path}`);
  for (const doc of docs) {
    const next = JSON.stringify(doc.value, null, 2) + "\n";
    if (doc.source === null || JSON.stringify(JSON.parse(doc.source)) !== JSON.stringify(doc.value))
      await writeFile(doc.path, next, doc.source);
  }
  return paths;
}
