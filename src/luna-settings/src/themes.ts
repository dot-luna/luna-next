import { fileURLToPath } from "node:url";
import { Luna, type ThemeOptions } from "@luna/api";

/** One-shot requests keep source validation and theme application in the shared API. */
export async function themeRequest(
  {
    operation,
    value = "",
    name,
    fingerprint,
  }: { operation: string; value?: string; name?: string; fingerprint?: string },
  options: ThemeOptions = {},
) {
  const source = value.startsWith("file:") ? fileURLToPath(value) : value;
  let result;
  switch (operation) {
    case "preview":
      return Luna.theme.info(source, options);
    case "list":
      break;
    case "install":
      result = await Luna.theme.install(source, { ...options, name, fingerprint });
      break;
    case "select":
      result = await Luna.theme.set(value, options);
      break;
    case "remove":
      result = await Luna.theme.remove([value], options);
      break;
    case "random":
      result = await Luna.theme.random(options);
      break;
    default:
      return { succes: false, errMessage: "Unknown theme action" };
  }
  if (result && !result.succes) return result;
  const entries = await Luna.theme.list(options);
  if (!entries.succes) return entries;
  const cards = [];
  for (const entry of entries.data) {
    const theme = await Luna.theme.inspect(entry.name, options);
    if (!theme.succes) return theme;
    const { colors } = theme.data;
    cards.push({
      ...entry,
      mode: colors.mode,
      background: colors.background,
      foreground: colors.bright_foreground,
      raised: colors.lighter_background,
      dark: colors.dark_background,
      accent: colors.accent,
      palette: [
        colors.accent,
        colors.secondary_accent,
        colors.success,
        colors.warning,
        colors.error,
        colors.foreground,
      ],
    });
  }
  return { succes: true, data: cards };
}

if (import.meta.main) {
  try {
    console.log(
      JSON.stringify(
        await themeRequest(
          {
            operation: Bun.argv[2] ?? "list",
            value: Bun.argv[3],
            name: Bun.argv[4] || undefined,
            fingerprint: Bun.argv[5] || undefined,
          },
          { authorization: "polkit" },
        ),
      ),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        succes: false,
        errMessage: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
