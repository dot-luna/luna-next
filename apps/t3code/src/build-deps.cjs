const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const pacman = "/usr/bin/pacman";
const dependencies = ["base-devel", "pkgconf", "imagemagick", "libxcrypt-compat"];

function command(run, program, args, capture = false, empty = false) {
  const result = run(program, args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  // Pacman reports an empty orphan query as exit status 1 without a diagnostic.
  if (result.status !== 0 && !(empty && result.status === 1 && !stdout.trim() && !stderr.trim())) {
    throw new Error(
      `${program} ${args.join(" ")} failed (${result.signal || result.status})${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
    );
  }
  return new Set(stdout.split(/\r?\n/).filter(Boolean));
}

/**
 * Keep the libsecret runtime installed, then temporarily install missing Arch
 * build dependencies. Remove only this transaction's additions that remain
 * unrequired dependencies; existing packages are retained.
 * Cleanup runs after a failed install or build; its errors accompany the original error.
 * The optional synchronous process runner lets tests avoid system package changes.
 */
function withBuildDependencies(callback, run = spawnSync) {
  let before = command(run, pacman, ["-Qq"], true);
  const desktop = process.env.WAYLAND_DISPLAY || process.env.DISPLAY;
  const elevate = desktop && fs.existsSync("/usr/bin/pkexec") ? "/usr/bin/pkexec" : "/usr/bin/sudo";
  if (!before.has("libsecret")) {
    command(run, elevate, [pacman, "-S", "--needed", "--noconfirm", "--", "libsecret"]);
    // Runtime dependencies and their transitives must outlive the source build.
    before = command(run, pacman, ["-Qq"], true);
  }
  const missing = dependencies.filter((name) => !before.has(name));
  if (!missing.length) return callback();

  const failures = [];
  let added = new Set();
  let value;
  try {
    command(run, elevate, [pacman, "-S", "--asdeps", "--needed", "--noconfirm", "--", ...missing]);
  } catch (error) {
    failures.push(error);
  }
  try {
    // Capture additions before the build so later installs cannot enter our cleanup set.
    added = new Set([...command(run, pacman, ["-Qq"], true)].filter((name) => !before.has(name)));
  } catch (error) {
    failures.push(error);
  }
  if (!failures.length) {
    try {
      value = callback();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    while (added.size) {
      const orphans = command(run, pacman, ["-Qdtq"], true, true);
      const removable = [...added].filter((name) => orphans.has(name));
      if (!removable.length) break;
      // Removing leaves can make their dependencies orphaned; never recurse into old packages.
      command(run, elevate, [pacman, "-R", "--noconfirm", "--", ...removable]);
      for (const name of removable) added.delete(name);
    }
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, failures.map((error) => error.message).join("; "));
  return value;
}

module.exports = { withBuildDependencies };
