import { readDocument } from "@/lib/files.ts";
import { valueAtKey } from "@/lib/keys.ts";
import { validate } from "@/lib/validation.ts";
import { themeSelection } from "@/modules/theme/selection.ts";
import { themeContext } from "@/modules/theme/context.ts";
import { polkitDefaults, polkitSettingsSchema } from "./schema.ts";

class PolkitSettingsStore {
  /** Read once, creating an empty JSONC file if missing. Never persist resolved defaults. */
  async read(context: { configFile: string }) {
    return validate(
      polkitSettingsSchema,
      (await readDocument(context.configFile)).value,
      context.configFile,
    );
  }

  async get({ context, key }: { context: { configFile: string }; key?: string }) {
    return valueAtKey({ value: await this.read(context), key, label: "Polkit" });
  }

  async snapshot(context: { configFile: string; env: Record<string, string> }) {
    const settings = { ...polkitDefaults, ...(await this.read(context)) };
    const theme = await themeSelection.current(themeContext.resolve({ env: context.env }));
    return { settings, theme };
  }
}
export const polkitSettings = new PolkitSettingsStore();
