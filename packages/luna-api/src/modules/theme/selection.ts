import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "pathe";
import { metadata, parse } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import type { ThemeContext } from "./context.ts";
import { themeNameSchema, themeSelectionSchema } from "./schema.ts";
import { themeValues } from "./values.ts";

/** Used when nothing is selected; resolving an empty source yields the bundled defaults. */
const fallbackTheme = "tokyo-night";

class ThemeSelection {
  /** Read the selection file afresh, creating an empty private one when it is missing. */
  async read(context: ThemeContext) {
    await mkdir(dirname(context.configFile), { recursive: true });
    try {
      const file = await open(context.configFile, "wx", 0o600);
      try {
        await file.writeFile("{}\n");
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const source = await readFile(context.configFile, "utf8");
    return {
      source,
      value: validate(themeSelectionSchema, parse(source, context.configFile), context.configFile),
    };
  }

  /** Return a valid theme name or throw INVALID_ARGUMENT. */
  validName(value: string) {
    if (!themeNameSchema.safeParse(value).success)
      throw new ApiError(
        "INVALID_ARGUMENT",
        "Theme names use lowercase letters, digits, underscores and hyphens",
      );
    return value;
  }

  /** Locate an installed theme folder; INVALID_PATH when it is missing or not a directory. */
  async path({ context, name }: { context: ThemeContext; name: string }) {
    const path = join(context.libraryDir, this.validName(name));
    if (!(await metadata(path))?.isDirectory())
      throw new ApiError("INVALID_PATH", `Installed theme must be a regular directory: ${path}`);
    return path;
  }

  /** Resolve an installed theme by name. */
  async inspect({ context, name }: { context: ThemeContext; name: string }) {
    return themeValues.resolve({
      source: await themeValues.read(await this.path({ context, name })),
      name,
    });
  }

  /** Resolve the selected theme, or the bundled defaults when none is selected. */
  async current(context: ThemeContext) {
    return this.resolved({ context, name: (await this.read(context)).value.theme?.name });
  }

  /** Resolve a selected name, falling back to the bundled defaults when it is unset. */
  async resolved({ context, name }: { context: ThemeContext; name?: string }) {
    return name
      ? this.inspect({ context, name })
      : themeValues.resolve({ source: {}, name: fallbackTheme });
  }
}

export const themeSelection = new ThemeSelection();
