import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "pathe";
import { readOptional } from "@/lib/files.ts";
import type { InstallContext } from "@/modules/self/install/command.ts";
import { mimeTypeSchema } from "./schema.ts";

export interface DesktopEntry {
  id: string;
  path: string;
  name: string;
  mimeTypes: string[];
  /** Eligible even when the native selector disables compatibility execution arguments. */
  terminal: boolean;
  available: boolean;
}

class DesktopCatalog {
  /**
   * Read the XDG application catalog once; an invalid user override still masks system entries.
   * When keys are given and only select the login shell, no catalog is needed and none is read.
   */
  async entries({
    context,
    keys,
  }: {
    context: InstallContext;
    keys?: string[];
  }): Promise<Map<string, DesktopEntry>> {
    const entries = new Map<string, DesktopEntry>();
    if (keys && !keys.some((key) => key !== "shell")) return entries;
    const home = context.env.XDG_DATA_HOME;
    const roots = [
      home && isAbsolute(home) ? home : join(context.home, ".local/share"),
      ...(context.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(isAbsolute),
    ];
    for (const root of new Set(roots)) {
      const applications = join(root, "applications");
      for (const relative of await this._applicationFiles(applications)) {
        const id = relative.replaceAll("/", "-");
        if (entries.has(id)) continue;
        const path = join(applications, relative);
        const source = await readOptional(path);
        entries.set(id, this._parseEntry({ context, id, path, source: source ?? "" }));
      }
    }
    return entries;
  }

  /** Exact types for a key; a wildcard expands to the valid types the entry advertises. */
  supportedTypes({ key, entry }: { key: string; entry: DesktopEntry | undefined }) {
    if (!key.endsWith("/*")) return [key];
    return [...new Set(entry?.mimeTypes ?? [])]
      .filter((type) => type.startsWith(key.slice(0, -1)) && mimeTypeSchema.safeParse(type).success)
      .sort();
  }

  /** Supported types a wildcard should set; exact manifest keys take precedence over wildcards. */
  mimeTypes({
    key,
    entry,
    configured,
  }: {
    key: string;
    entry: DesktopEntry | undefined;
    configured: Record<string, string>;
  }) {
    if (!key.endsWith("/*")) return [key];
    return this.supportedTypes({ key, entry }).filter((type) => !Object.hasOwn(configured, type));
  }

  private async _applicationFiles(directory: string, prefix = ""): Promise<string[]> {
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const files: string[] = [];
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix + child.name;
      if (child.isDirectory())
        files.push(...(await this._applicationFiles(join(directory, child.name), relative + "/")));
      else if (child.name.endsWith(".desktop")) files.push(relative);
    }
    return files;
  }

  private _parseEntry({
    context,
    id,
    path,
    source,
  }: {
    context: InstallContext;
    id: string;
    path: string;
    source: string;
  }): DesktopEntry {
    const values = new Map<string, string>();
    let active = false;
    let found = false;
    let valid = true;
    for (const line of source.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.startsWith("[")) {
        active = trimmed === "[Desktop Entry]";
        if (active && found) valid = false;
        if (active) found = true;
        continue;
      }
      if (!active) continue;
      const equals = line.indexOf("=");
      if (equals < 1) {
        valid = false;
        continue;
      }
      const key = line.slice(0, equals).trim();
      if (values.has(key)) valid = false;
      values.set(key, line.slice(equals + 1).trim());
    }
    const name = this._desktopString(values.get("Name") ?? "");
    const categories = this._desktopString(values.get("Categories") ?? "");
    const mimeTypes = this._desktopString(values.get("MimeType") ?? "");
    const tryExec = values.has("TryExec") ? this._desktopString(values.get("TryExec")!) : undefined;
    const exec = values.has("Exec") ? this._execProgram(values.get("Exec")!) : undefined;
    const terminalArgument = values.get("TerminalArgExec") ?? values.get("X-TerminalArgExec");
    for (const key of ["Hidden", "DBusActivatable", "Terminal"])
      if (values.has(key) && !["true", "false"].includes(values.get(key)!)) valid = false;
    return {
      id,
      path,
      name: name || id,
      mimeTypes: mimeTypes?.split(";").filter(Boolean) ?? [],
      terminal:
        Boolean(categories?.split(";").includes("TerminalEmulator")) &&
        terminalArgument !== undefined &&
        this._desktopString(terminalArgument) !== null,
      available:
        valid &&
        found &&
        values.get("Type") === "Application" &&
        values.get("Hidden") !== "true" &&
        Boolean(name) &&
        categories !== null &&
        mimeTypes !== null &&
        (tryExec === undefined ||
          (tryExec !== null && this._executable({ context, command: tryExec }))) &&
        (exec === undefined
          ? values.get("DBusActivatable") === "true"
          : exec !== null && this._executable({ context, command: exec })),
    };
  }

  private _executable({ context, command }: { context: InstallContext; command: string }) {
    if (!command || (!isAbsolute(command) && command.includes("/"))) return false;
    return Bun.which(command, { PATH: context.env.PATH ?? "", cwd: context.home }) !== null;
  }

  /** Desktop values are unescaped before the separate Exec quoting rules are applied. */
  private _desktopString(value: string): string | null {
    const escapes: Record<string, string> = {
      s: " ",
      n: "\n",
      t: "\t",
      r: "\r",
      "\\": "\\",
      ";": ";",
    };
    let decoded = "";
    for (let index = 0; index < value.length; index++) {
      const character = value[index]!;
      if (character !== "\\") decoded += character;
      else {
        const replacement = escapes[value[++index]!];
        if (replacement === undefined) return null;
        decoded += replacement;
      }
    }
    return decoded;
  }

  /** Parsing never runs the command or expands shell syntax. Only the executable is looked up. */
  private _execProgram(value: string): string | null {
    const decoded = this._desktopString(value);
    if (decoded === null) return null;
    const tokens: { value: string; quoted: boolean }[] = [];
    let index = 0;
    while (index < decoded.length) {
      while (decoded[index] === " " || decoded[index] === "\t") index++;
      if (index === decoded.length) break;
      const quoted = decoded[index] === '"';
      if (quoted) index++;
      let token = "";
      let closed = !quoted;
      while (index < decoded.length) {
        const character = decoded[index++]!;
        if (quoted) {
          if (character === '"') {
            closed = true;
            break;
          }
          if (character === "\\") {
            const escaped = decoded[index++]!;
            if (!['"', "`", "$", "\\"].includes(escaped)) return null;
            token += escaped;
          } else {
            if (character === "$" || character === "`") return null;
            token += character;
          }
        } else {
          if (character === " " || character === "\t") break;
          if (/[\n\r"'\\><~|&;$*?#()`]/u.test(character)) return null;
          token += character;
        }
      }
      if (!closed || (quoted && index < decoded.length && !/[ \t]/u.test(decoded[index]!)))
        return null;
      tokens.push({ value: token, quoted });
    }
    let fileFields = 0;
    for (const [position, token] of tokens.entries()) {
      for (let offset = 0; offset < token.value.length; offset++) {
        if (token.value[offset] !== "%") continue;
        const code = token.value[++offset];
        if (code === "%") continue;
        if (!code || !"fFuUickdDnNvm".includes(code) || position === 0 || token.quoted) return null;
        if ("fFuU".includes(code)) fileFields++;
        if ("FUi".includes(code) && token.value !== "%" + code) return null;
      }
    }
    if (fileFields > 1) return null;
    const program = tokens[0]?.value.replaceAll("%%", "%");
    return program && !program.includes("=") ? program : null;
  }
}

export const desktopCatalog = new DesktopCatalog();
