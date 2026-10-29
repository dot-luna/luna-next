const fs = require("node:fs");
const path = require("node:path");

function replaceOnce(source, previous, next, file) {
  const first = source.indexOf(previous);
  if (first === -1 || source.indexOf(previous, first + previous.length) !== -1) {
    throw new Error(`T3 source changed: expected one ${JSON.stringify(previous)} in ${file}`);
  }
  return source.slice(0, first) + next + source.slice(first + previous.length);
}

function patchDesktopEntry(source, file) {
  source = replaceOnce(
    source,
    '// The AppImage integration entry owns the window identity. This\n// hidden URL-only entry must not compete with it for StartupWMClass matching.',
    '// The installed desktop entry serves both the app menu and URL handling.',
    file,
  );
  return replaceOnce(
    source,
    '    "NoDisplay=true",',
    '    "NoDisplay=false",\n    "Categories=Development;IDE;",\n    "StartupWMClass=t3code",',
    file,
  );
}

/**
 * Build with square controls and menu integration, then restore original bytes and modes.
 * The callback must finish synchronously; an upstream contract mismatch fails before any write.
 * Existing client preferences and application data are never opened or replaced.
 */
function withPreparedSources(checkout, cssPath, callback) {
  const css = fs.readFileSync(cssPath, "utf8");
  if (!css.trim()) throw new Error("T3 boxy CSS must not be empty");
  const patches = [
    ["apps/web/src/index.css", (source) => `${source.trimEnd()}\n\n/* Luna square controls override upstream component styles. */\n${css.trim()}\n`],
    ["apps/desktop/src/app/DesktopLinuxUrlHandler.ts", patchDesktopEntry],
  ].map(([relative, patch]) => {
    const file = path.join(checkout, relative);
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error(`T3 source must be a regular file: ${file}`);
    const original = fs.readFileSync(file);
    return { file, original, mode: stat.mode, updated: patch(original.toString("utf8"), file) };
  });

  const changed = [];
  let buildError;
  try {
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
    if (failures.length) {
      throw new AggregateError(
        buildError ? [buildError, ...failures] : failures,
        "Could not restore T3 source files",
      );
    }
  }
}

module.exports = { withPreparedSources };
