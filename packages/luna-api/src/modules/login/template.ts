import { validate } from "@/lib/validation.ts";
import { themeContext } from "@/modules/theme/context.ts";
import { themeImages } from "@/modules/theme/images.ts";
import { themeSelection } from "@/modules/theme/selection.ts";
import { loginDefaults } from "./defaults.ts";
import { loginSettings } from "./settings.ts";
import { loginSettingsSchema } from "./schema.ts";

class LoginTemplate {
  /** Snapshot the selected theme and its first image; explicit template tokens win. Video-only themes use a solid background. */
  async resolve({ template, env }: { template: unknown; env?: Record<string, string> }) {
    const authored = validate(loginSettingsSchema, template, "Login template");
    const context = themeContext.resolve({ env });
    const theme = await themeSelection.current(context);
    const colors = Object.fromEntries(
      Object.entries(loginDefaults.theme.colors).map(([key, fallback]) => [
        key,
        theme.colors[key] ?? fallback,
      ]),
    );
    const background = authored.background?.path
      ? undefined
      : await themeImages.first({ context, theme });
    return loginSettings.patch({
      previous: {
        theme: {
          colors,
          fonts: { ui: theme.fonts.ui },
          appearance: { rounding: theme.appearance.rounding, blur: theme.appearance.blur },
        },
        background: background ? { path: background } : {},
        login: loginDefaults.login,
      },
      patch: authored,
    });
  }
}
export const loginTemplate = new LoginTemplate();
