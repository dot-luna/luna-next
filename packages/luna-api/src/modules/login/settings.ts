import { readDocument, writeFile } from "@/lib/files.ts";
import { valueAtKey } from "@/lib/keys.ts";
import { validate } from "@/lib/validation.ts";
import { ApiError } from "@/lib/response.ts";
import type { LoginContext } from "./context.ts";
import { loginSettingsSchema, type LoginSettings } from "./schema.ts";

class LoginSettingsStore {
  async read(context: LoginContext) {
    const document = await readDocument(context.configFile);
    return {
      source: document.source,
      value: validate(loginSettingsSchema, document.value, context.configFile),
    };
  }

  async get({ context, key }: { context: LoginContext; key?: string }) {
    return valueAtKey({ value: (await this.read(context)).value, key, label: "Login" });
  }

  /** Merge only supplied tokens; standalone defaults never enter the authored document. */
  patch({ previous, patch }: { previous: LoginSettings; patch: unknown }): LoginSettings {
    const parsed = loginSettingsSchema.safeParse(patch);
    if (!parsed.success) throw new ApiError("INVALID_ARGUMENT", parsed.error.message);
    const changes = parsed.data;
    const next = { ...previous, ...changes };
    for (const group of ["screen", "background", "actions", "login"] as const)
      if (changes[group]) next[group] = { ...previous[group], ...changes[group] };
    if (changes.theme) {
      next.theme = { ...previous.theme, ...changes.theme };
      if (changes.theme.colors)
        next.theme.colors = { ...previous.theme?.colors, ...changes.theme.colors };
      if (changes.theme.fonts)
        next.theme.fonts = { ...previous.theme?.fonts, ...changes.theme.fonts };
      if (changes.theme.appearance) {
        next.theme.appearance = { ...previous.theme?.appearance, ...changes.theme.appearance };
        if (changes.theme.appearance.blur)
          next.theme.appearance.blur = {
            ...previous.theme?.appearance?.blur,
            ...changes.theme.appearance.blur,
          };
      }
    }
    return validate(loginSettingsSchema, next, "Login settings");
  }

  /** Caller holds the config lock. Failed application restores bytes only if no external edit replaced them. */
  async save({
    context,
    previous,
    value,
    apply,
  }: {
    context: LoginContext;
    previous: { source: string; value: LoginSettings };
    value: LoginSettings;
    apply: () => Promise<unknown>;
  }) {
    const source = JSON.stringify(value, null, 2) + "\n";
    await writeFile(context.configFile, source, previous.source);
    try {
      await apply();
    } catch (error) {
      try {
        await writeFile(context.configFile, previous.source, source);
      } catch (recovery) {
        throw new ApiError("CONFLICT", `${String(error)}; settings recovery: ${String(recovery)}`);
      }
      throw error;
    }
    return value;
  }
}
export const loginSettings = new LoginSettingsStore();
