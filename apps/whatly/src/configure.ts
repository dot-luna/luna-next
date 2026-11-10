import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { absolute, installFile, safePath } from "../scripts/common.ts";

type Theme = {
  colors: Record<string, string>;
  fonts: { ui: string; mono: string };
  appearance: { rounding: number };
};
type Snapshot = { file: string; source: string | null; mode: number };
const config = new URL("../config/", import.meta.url);

function snapshot(file: string): Snapshot {
  safePath(file);
  if (!fs.existsSync(file)) return { file, source: null, mode: 0o600 };
  const info = fs.statSync(file);
  if (!info.isFile()) throw new Error("Expected a regular Whatly file: " + file);
  return { file, source: fs.readFileSync(file, "utf8"), mode: info.mode & 0o777 };
}

function unchanged(original: Snapshot): void {
  const current = snapshot(original.file);
  if (current.source !== original.source || current.mode !== original.mode) {
    throw new Error("Whatly configuration changed during setup: " + original.file);
  }
}

/** Replace managed General keys without interpreting account data or shortcut values. */
export function settings({ source, defaults }: { source: string; defaults: string }): string {
  const values = defaults.split(/\r?\n/u).filter((line) => /^[a-zA-Z]+=/u.test(line));
  const keys = new Set(values.map((line) => line.slice(0, line.indexOf("="))));
  const lines = source.split(/\r?\n/u);
  const result: string[] = [];
  let general = true;
  let inserted = false;
  for (let index = 0; index < lines.length; index++) {
    const first = lines[index]!;
    const block = [first];
    // QSettings permits backslash continuations; replace the complete value together.
    while ((block.at(-1)!.match(/\\+$/u)?.[0].length ?? 0) % 2 === 1 && index + 1 < lines.length) {
      block.push(lines[++index]!);
    }
    const section = /^\s*\[([^\]]+)\]\s*(?:;.*)?$/u.exec(first);
    if (section) {
      general = section[1] === "General";
      result.push(...block);
      if (general && !inserted) {
        result.push(...values);
        inserted = true;
      }
    } else {
      const key = /^\s*([^=;#]+?)\s*=/u.exec(first)?.[1];
      if (!general || !key || !keys.has(key)) result.push(...block);
    }
  }
  if (!inserted) result.unshift("[General]", ...values);
  return result.join("\n").replace(/\n*$/u, "\n");
}

// QSettings treats unquoted commas as lists and leading @ as a QVariant marker.
function iniString(value: string): string {
  return '"' + value.replace(/^@/u, "@@").replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
}

function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/gu, (_, key: string) => {
    if (!Object.hasOwn(values, key) || typeof values[key] !== "string") {
      throw new Error("Missing Whatly theme value: " + key);
    }
    return values[key]!;
  });
}

/** Resolve one Luna theme and publish the default profile's CSS and managed settings. */
export function configure(): void {
  const home = absolute(Bun.env.HOME || "", "HOME");
  const configHome = absolute(
    Bun.env.XDG_CONFIG_HOME || path.join(home, ".config"),
    "XDG_CONFIG_HOME",
  );
  const dataHome = absolute(
    Bun.env.XDG_DATA_HOME || path.join(home, ".local/share"),
    "XDG_DATA_HOME",
  );
  const native = snapshot(path.join(configHome, "shakaran/whatly.conf"));
  const css = snapshot(path.join(dataHome, "shakaran/whatly/custom.css"));

  // The CLI owns theme validation and resolution, including light-mode defaults.
  const command = Bun.spawnSync(["luna", "theme", "get", "--json"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  if (!command.success)
    throw new Error("Cannot resolve Luna's theme: " + command.stderr.toString().trim());
  const response = JSON.parse(command.stdout.toString());
  if (response.succes !== true)
    throw new Error(response.errMessage || "Cannot resolve Luna's theme.");
  const theme = response.data as Theme;
  const values: Record<string, string> = {
    mode: theme.colors.mode!,
    ui_font: JSON.stringify(theme.fonts.ui),
    mono_font: JSON.stringify(theme.fonts.mono),
    square_corners:
      theme.appearance.rounding === 0 ? fs.readFileSync(new URL("square.css", config), "utf8") : "",
  };
  for (const [role, value] of Object.entries(theme.colors)) {
    values["colors." + role] = value;
    if (role !== "mode") {
      values["rgb." + role] = [1, 3, 5]
        .map((offset) => parseInt(value.slice(offset, offset + 2), 16))
        .join(", ");
    }
  }
  const defaults = render(fs.readFileSync(new URL("whatly.conf", config), "utf8"), {
    mode: values.mode!,
    ui_font: iniString(theme.fonts.ui),
  });
  const stylesheet = render(fs.readFileSync(new URL("theme.template.css", config), "utf8"), values);
  const contents = settings({ source: native.source ?? "", defaults });

  // Publish CSS before enabling it. Each file is atomic; a late failure can leave CSS updated.
  unchanged(native);
  unchanged(css);
  const staging = fs.mkdtempSync(path.join(tmpdir(), "luna-whatly-config-"));
  try {
    for (const [original, text] of [
      [css, stylesheet],
      [native, contents],
    ] as const) {
      unchanged(original);
      const staged = path.join(staging, "file");
      fs.writeFileSync(staged, text, { mode: 0o600 });
      installFile(staged, original.file, original.mode);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
