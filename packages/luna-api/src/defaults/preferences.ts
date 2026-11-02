import { isAbsolute, join } from "pathe";
import { readOptional, writeFile } from "../lib/files.ts";
import { canonicalPath } from "../lib/paths.ts";
import { ApiError } from "../lib/response.ts";
import { InstallContext } from "../self/install/command.ts";

export interface PreferenceWrite {
  path: string;
  previous: string | null;
  contents: string;
}

/** Ask native selectors for their effective values without launching an application. */
export async function readCurrent(
  context: InstallContext,
  keys: string[],
): Promise<Record<string, string | null>> {
  const values: Record<string, string | null> = {};
  for (const key of keys) {
    if (key === "shell") continue;
    const tool = key === "terminal" ? "xdg-terminal-exec" : "xdg-mime";
    requireTool(context, tool);
    const args = key === "terminal" ? [tool, "--print-id"] : [tool, "query", "default", key];
    const selector =
      key === "terminal"
        ? new InstallContext(
            context.repository,
            context.home,
            { ...context.env, XTE_CACHE_ENABLED: "0" },
            context.onProgress,
            context.log,
          )
        : context;
    const result = await selector.execute(args, true);
    values[key] = result.exitCode === 0 ? result.stdout.trim() || null : null;
  }
  return values;
}

/**
 * Read and resolve every destination before writes begin. Choices must already be validated
 * against the installed desktop catalog; returned snapshots support conflict-safe writes.
 */
export async function preparePreferenceWrites(
  context: InstallContext,
  choices: Record<string, string>,
): Promise<PreferenceWrite[]> {
  const selectedRoot = context.env.XDG_CONFIG_HOME;
  const root =
    selectedRoot && isAbsolute(selectedRoot) ? selectedRoot : join(context.home, ".config");
  const desktops = desktopNames(context);
  const terminal = choices.terminal;
  const mime = Object.fromEntries(
    Object.entries(choices).filter(([key]) => key !== "terminal" && key !== "shell"),
  );
  const planned = new Map<string, PreferenceWrite>();
  const repository = await canonicalPath(context.repository);
  const plan = async (filename: string, transform: (source: string) => string) => {
    const path = await canonicalPath(join(root, filename));
    if (path === repository || path.startsWith(repository + "/"))
      throw new ApiError(
        "INVALID_PATH",
        `Desktop preferences must be outside the checkout: ${path}`,
      );
    const existing = planned.get(path);
    const previous = existing?.previous ?? (await readOptional(path));
    const contents = transform(existing?.contents ?? previous ?? "");
    planned.set(path, { path, previous, contents });
  };
  if (Object.keys(mime).length) {
    // Desktop-specific files outrank generic defaults, but cannot add/remove associations.
    await plan("mimeapps.list", (source) => mimePreferences(source, mime, true));
    for (const desktop of desktops)
      await plan(`${desktop}-mimeapps.list`, (source) => mimePreferences(source, mime, false));
  }
  if (terminal) {
    requireTool(context, "xdg-terminal-exec");
    await plan("xdg-terminals.list", (source) => terminalPreference(source, terminal));
    for (const desktop of desktops)
      await plan(`${desktop}-xdg-terminals.list`, (source) => terminalPreference(source, terminal));
  }
  return [...planned.values()];
}

/** Save each preference file atomically; an I/O failure can leave earlier files applied. */
export async function writePreferences(context: InstallContext, choices: Record<string, string>) {
  const writes = await preparePreferenceWrites(context, choices);
  for (const write of writes) await writeFile(write.path, write.contents, write.previous);
}

function requireTool(context: InstallContext, tool: string) {
  if (!Bun.which(tool, { PATH: context.env.PATH ?? "", cwd: context.home }))
    throw new ApiError("INVALID_ENVIRONMENT", `${tool} is required to manage desktop defaults`);
}

function desktopNames(context: InstallContext) {
  const desktops = (context.env.XDG_CURRENT_DESKTOP ?? "").split(":").filter(Boolean);
  for (const desktop of desktops)
    if (!/^[A-Za-z0-9_.-]+$/u.test(desktop) || desktop === "." || desktop === "..")
      throw new ApiError(
        "INVALID_ENVIRONMENT",
        "XDG_CURRENT_DESKTOP contains an invalid desktop name",
      );
  // Luna configures Hyprland even when installation runs from another desktop or a TTY.
  return [...new Set([...desktops.map((desktop) => desktop.toLowerCase()), "hyprland"])];
}

function mimePreferences(source: string, choices: Record<string, string>, associations: boolean) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source ? source.replaceAll("\r\n", "\n").split("\n") : [];
  for (const [type, id] of Object.entries(choices)) {
    updateGroup(lines, "Default Applications", type, (current) => preferred(id, current));
    if (associations) {
      updateGroup(lines, "Added Associations", type, (current) => preferred(id, current));
      updateGroup(
        lines,
        "Removed Associations",
        type,
        (current) => current.filter((entry) => entry !== id),
        false,
      );
    }
  }
  return lines.join(newline);
}

function preferred(id: string, current: string[]) {
  return [id, ...current.filter((entry) => entry !== id)];
}

/** Only selected keys change; unrelated groups, comments and fallback application order survive. */
function updateGroup(
  lines: string[],
  group: string,
  key: string,
  transform: (current: string[]) => string[],
  create = true,
) {
  let active = false;
  let sectionEnd = -1;
  const matches: number[] = [];
  const current: string[] = [];
  for (const [index, line] of lines.entries()) {
    const header = /^\s*\[([^\]]+)\]\s*$/u.exec(line);
    if (header) {
      if (active) sectionEnd = index;
      active = header[1] === group;
      if (active) sectionEnd = lines.length;
    }
    if (!active || line.trim().startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 0 || line.slice(0, equals).trim() !== key) continue;
    matches.push(index);
    current.push(
      ...line
        .slice(equals + 1)
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
  }
  if (!matches.length && !create) return;
  const entries = [...new Set(transform(current))];
  const replacement = entries.length ? `${key}=${entries.join(";")};` : null;
  if (matches.length) {
    for (const index of matches.slice(1).reverse()) lines.splice(index, 1);
    if (replacement === null) lines.splice(matches[0]!, 1);
    else lines[matches[0]!] = replacement;
    return;
  }
  if (replacement === null) return;
  if (sectionEnd >= 0) {
    const index = sectionEnd === lines.length && lines.at(-1) === "" ? sectionEnd - 1 : sectionEnd;
    lines.splice(index, 0, replacement);
  } else {
    if (lines.length && lines.at(-1) !== "") lines.push("");
    lines.push(`[${group}]`, replacement, "");
  }
}

function terminalPreference(source: string, id: string) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source ? source.replaceAll("\r\n", "\n").split("\n") : [];
  const retained = lines.filter((line) => ![id, "-" + id, "+" + id].includes(line.trim()));
  // Keep introductory comments ahead of the selection while placing it before existing directives.
  let index = 0;
  const contentEnd = retained.length - (retained.at(-1) === "" ? 1 : 0);
  while (
    index < contentEnd &&
    (!retained[index]!.trim() || retained[index]!.trim().startsWith("#"))
  )
    index++;
  retained.splice(index, 0, id);
  if (retained.at(-1) !== "") retained.push("");
  return retained.join(newline);
}
