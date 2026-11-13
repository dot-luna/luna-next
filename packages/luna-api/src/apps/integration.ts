import { createHash } from "node:crypto";
import { readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "pathe";
import { z } from "zod";
import { ApiError } from "../lib/response.ts";
import { metadata, parse, readOptional, writeFile } from "../lib/files.ts";
import { validate } from "../lib/validation.ts";
import type { InstallContext } from "../self/install/command.ts";

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const record = z.record(z.string(), z.unknown());
const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(
    value &&
    typeof value === "object" &&
    [null, Object.prototype].includes(Object.getPrototypeOf(value)),
  );

function merge(defaults: Record<string, unknown>, user: Record<string, unknown>) {
  const value = { ...defaults };
  for (const [key, item] of Object.entries(user)) {
    Object.defineProperty(value, key, {
      value: plain(item) && plain(defaults[key]) ? merge(defaults[key], item) : item,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return value;
}

/** Expand only declared variables. An unset variable skips the entire destination candidate. */
export async function userDestination(context: InstallContext, candidates: string[], cwd: string) {
  for (const candidate of candidates) {
    let value = candidate;
    if (value.startsWith("!")) {
      const result = await context.execute(["bash", "-c", value.slice(1)], true, cwd);
      if (result.exitCode !== 0 || !result.stdout.trim()) continue;
      value = result.stdout.trim();
    } else {
      let missing = false;
      value = value.replace(
        /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/gu,
        (_, a: string, b: string) => {
          const resolved = context.env[a || b];
          if (!resolved) missing = true;
          return resolved ?? "";
        },
      );
      if (missing) continue;
      if (value === "~" || value.startsWith("~/")) value = context.home + value.slice(1);
    }
    if (!value) continue;
    // oxlint-disable-next-line no-control-regex
    if (!isAbsolute(value) || /[\x00-\x1f\x7f]/u.test(value) || resolve(value) === "/")
      throw new ApiError("INVALID_PATH", `Invalid user configuration destination: ${value}`);
    return resolve(value);
  }
  throw new ApiError("INVALID_PATH", "No user configuration destination could be resolved");
}

function includeSource(target: string, source: string, existing: string) {
  const extension = extname(source);
  const lua = extension === ".lua";
  const css = extension === ".css";
  const prefix = lua ? "--" : css ? "/*" : "#";
  const suffix = css ? " */" : "";
  const id = createHash("sha256").update(source).digest("hex");
  const start = `${prefix} BEGIN LUNA ${id}${suffix}`;
  const end = `${prefix} END LUNA ${id}${suffix}`;
  let body = existing;
  const first = body.indexOf(start);
  if (first !== -1) {
    const last = body.indexOf(end, first);
    if (last === -1)
      throw new ApiError("INVALID_METADATA", `Incomplete Luna include block: ${target}`);
    body = body.slice(0, first) + body.slice(last + end.length).replace(/^\r?\n/u, "");
  }
  // CSS imports must precede rules, so the prepended block also keeps user rules overriding.
  const line = lua
    ? `dofile(${JSON.stringify(source)})`
    : css
      ? `@import url(${JSON.stringify(Bun.pathToFileURL(source).href)});`
      : extension === ".conf"
        ? `include ${source}`
        : `source ${shellQuote(source)}`;
  return `${start}\n${line}\n${end}\n${body}`;
}

function mergeSource(target: string, source: string, defaults: string, user: string | null) {
  if (user === null) return defaults;
  const extension = extname(source);
  if ([".json", ".jsonc", ".toml", ".yml", ".yaml"].includes(extension)) {
    const decode = (source: string) =>
      validate(
        record,
        extension === ".toml"
          ? Bun.TOML.parse(source)
          : [".yml", ".yaml"].includes(extension)
            ? Bun.YAML.parse(source)
            : parse(source, target),
        target,
      );
    const value = merge(decode(defaults), decode(user));
    return extension === ".toml"
      ? Bun.TOML.stringify(value)
      : [".yml", ".yaml"].includes(extension)
        ? Bun.YAML.stringify(value, null, 2)
        : JSON.stringify(value, null, 2) + "\n";
  }
  // btop/mpv-style assignments, bat-style long flags and mpv-style "KEY command" bindings
  // keep existing lines and values intact.
  const key = (line: string) =>
    line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*=/u)?.[1] ??
    line.match(/^\s*(--[a-zA-Z0-9_-]+)(?=[=\s]|$)/u)?.[1] ??
    line.match(/^\s*([^\s#=]+)\s+\S/u)?.[1];
  const existing = new Set(user.split(/\r?\n/u).map(key).filter(Boolean));
  const missing = defaults.split(/\r?\n/u).filter((line) => {
    const name = key(line);
    return name && !existing.has(name);
  });
  if (!missing.length) return user;
  return (user ? user.replace(/\n?$/u, "\n") : "") + missing.join("\n") + "\n";
}

export async function integrate(
  source: string,
  target: string,
  mode: "merge" | "include",
): Promise<void> {
  if ((await metadata(source))?.isDirectory()) {
    for (const entry of await readdir(source))
      await integrate(join(source, entry), join(target, entry), mode);
    return;
  }
  if (resolve(source) === resolve(target)) return;
  if (
    (await metadata(target))?.isSymbolicLink() &&
    (await realpath(target)) === (await realpath(source))
  )
    return;
  const previous = await readOptional(target);
  const content = await Bun.file(source).text();
  const next =
    mode === "include"
      ? includeSource(target, source, previous ?? "")
      : mergeSource(target, source, content, previous);
  await writeFile(target, next, previous);
}
