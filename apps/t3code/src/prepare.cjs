const fs = require("node:fs");
const path = require("node:path");

const fontKeys = ["fontFamilySans", "fontFamilyCode", "fontFamilyComposer", "fontFamilyTerminal"];

function readDefaults(file) {
  const raw = fs.readFileSync(file);
  const defaults = JSON.parse(raw);
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    throw new Error("T3 defaults must be a JSON object");
  }
  const keys = [...fontKeys, "mathRenderingEnabled"];
  if (
    Object.keys(defaults).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(defaults, key))
  ) {
    throw new Error(`T3 defaults must contain only ${keys.join(", ")}`);
  }
  for (const key of fontKeys) {
    const value = defaults[key];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 200 ||
      /[\x00-\x1f\x7f]/.test(value)
    ) {
      throw new Error(`Invalid T3 default ${key}: expected a font family of 1–200 characters`);
    }
  }
  if (typeof defaults.mathRenderingEnabled !== "boolean") {
    throw new Error("Invalid T3 default mathRenderingEnabled: expected a boolean");
  }
  return { defaults, raw };
}

function replaceOnce(source, previous, next, file) {
  const first = source.indexOf(previous);
  if (first === -1 || source.indexOf(previous, first + previous.length) !== -1) {
    throw new Error(`T3 source changed: expected one ${JSON.stringify(previous)} in ${file}`);
  }
  return source.slice(0, first) + next + source.slice(first + previous.length);
}

function patchSettings(source, file) {
  for (const key of fontKeys) {
    source = replaceOnce(
      source,
      `  ${key}: FontFamilyPreference.pipe(Schema.withDecodingDefault(Effect.succeed(""))),`,
      `  ${key}: FontFamilyPreference.pipe(Schema.withDecodingDefault(Effect.succeed(lunaDefaults.${key}))),`,
      file,
    );
  }
  source = replaceOnce(
    source,
    "  mathRenderingEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),",
    "  mathRenderingEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(lunaDefaults.mathRenderingEnabled))),",
    file,
  );
  source = replaceOnce(
    source,
    "  // Opt-in TeX typesetting in rendered Markdown. Off keeps math parsing and\n  // KaTeX out of the render path entirely.",
    "  // Disabling TeX keeps math parsing and KaTeX out of the render path entirely.",
    file,
  );
  return `import lunaDefaults from "./luna-defaults.json" with { type: "json" };\n${source}`;
}

function patchFontStacks(source, file) {
  for (const [name, key] of [
    ["SANS", "fontFamilySans"],
    ["CODE", "fontFamilyCode"],
  ]) {
    const expression = new RegExp(`export const DEFAULT_${name}_FONT_STACK =\\n  ('[^'\\n]+');`);
    const matches = [...source.matchAll(new RegExp(expression, "g"))];
    if (matches.length !== 1) {
      throw new Error(`T3 source changed: expected one DEFAULT_${name}_FONT_STACK in ${file}`);
    }
    source = source.replace(
      expression,
      `export const DEFAULT_${name}_FONT_STACK = [\n  JSON.stringify(lunaDefaults.${key}),\n  $1,\n].join(", ");`,
    );
  }
  return `import lunaDefaults from "../../../packages/contracts/src/luna-defaults.json" with { type: "json" };\n${source}`;
}

function patchCss(source, defaults, css, file) {
  // Empty saved font preferences mean the built-in stack, so update those tokens too.
  for (const [token, key] of [
    ["sans", "fontFamilySans"],
    ["mono", "fontFamilyCode"],
  ]) {
    const expression = new RegExp(`(  --font-${token}:\\s*\\n    )([^;]+);`, "g");
    if ([...source.matchAll(expression)].length !== 1) {
      throw new Error(`T3 source changed: expected one --font-${token} theme token in ${file}`);
    }
    source = source.replace(
      expression,
      (_, prefix, stack) => `${prefix}${JSON.stringify(defaults[key])}, ${stack};`,
    );
  }
  return `${source.trimEnd()}\n\n/* Luna's desktop shape is applied after upstream component styles. */\n${css.trim()}\n`;
}

/**
 * Build with Luna defaults and CSS, then restore the checkout's original bytes and modes.
 * The callback must finish synchronously; an upstream contract mismatch fails before any write.
 * Existing client preferences and application data are never opened or replaced.
 */
function withPreparedSources(checkout, defaultsPath, cssPath, callback) {
  const { defaults, raw } = readDefaults(defaultsPath);
  const css = fs.readFileSync(cssPath, "utf8");
  if (!css.trim()) throw new Error("T3 boxy CSS must not be empty");
  const defaultsTarget = path.join(checkout, "packages/contracts/src/luna-defaults.json");
  try {
    fs.lstatSync(defaultsTarget);
    throw new Error(`T3 build defaults already exist: ${defaultsTarget}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const patches = [
    ["packages/contracts/src/settings.ts", patchSettings],
    ["apps/web/src/appearanceFonts.ts", patchFontStacks],
    ["apps/web/src/index.css", (source, file) => patchCss(source, defaults, css, file)],
  ].map(([relative, patch]) => {
    const file = path.join(checkout, relative);
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error(`T3 source must be a regular file: ${file}`);
    const original = fs.readFileSync(file);
    return { file, original, mode: stat.mode, updated: patch(original.toString("utf8"), file) };
  });

  const changed = [];
  let createdDefaults = false;
  let buildError;
  try {
    fs.writeFileSync(defaultsTarget, raw, { flag: "wx", mode: 0o644 });
    createdDefaults = true;
    for (const patch of patches) {
      changed.push(patch);
      fs.writeFileSync(patch.file, patch.updated);
    }
    const result = callback();
    if (result && typeof result.then === "function") {
      throw new Error("T3 source preparation requires a synchronous build callback");
    }
    return result;
  } catch (error) {
    buildError = error;
    throw error;
  } finally {
    const failures = [];
    for (const patch of changed.reverse()) {
      try {
        fs.writeFileSync(patch.file, patch.original);
        fs.chmodSync(patch.file, patch.mode);
      } catch (error) {
        failures.push(error);
      }
    }
    if (createdDefaults) {
      try {
        fs.unlinkSync(defaultsTarget);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) {
      throw new AggregateError(
        buildError ? [buildError, ...failures] : failures,
        "Could not restore T3 source files",
      );
    }
  }
}

module.exports = { withPreparedSources };
