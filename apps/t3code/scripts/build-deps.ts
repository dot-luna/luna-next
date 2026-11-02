#!/usr/bin/env bun
/**
 * Scoped Arch build dependencies for T3's Bun build hook.
 *
 * Keep libsecret and its runtime dependencies installed. Temporarily add missing
 * build-only packages, execute the synchronous build, then remove only additions from
 * that transaction that remain unused dependencies. Never remove preexisting orphans.
 * Cleanup also runs after a failed package install or build; both errors are reported.
 * The build hook calls this helper within its own stage, so failed builds do not depend
 * on after_build running. Tests supply a process runner and never change system packages.
 */
import * as fs from "node:fs";

type Result = { status: number | null; stdout?: string; stderr?: string; error?: Error; signal?: string };
export type Runner = (program: string, args: string[], options?: { capture: boolean }) => Result;

const pacman = "/usr/bin/pacman";
const dependencies = ["base-devel", "pkgconf", "imagemagick", "libxcrypt-compat"];

const spawn: Runner = (program, args, options) => {
  const capture = options?.capture === true;
  const result = Bun.spawnSync([program, ...args], {
    stdin: capture ? "ignore" : "inherit", stdout: capture ? "pipe" : "inherit", stderr: capture ? "pipe" : "inherit",
  });
  return { status: result.exitCode, stdout: result.stdout?.toString(), stderr: result.stderr?.toString() };
};

function command(run: Runner, program: string, args: string[], capture = false, empty = false): Set<string> {
  const result = run(program, args, { capture });
  if (result.error) throw result.error;
  const stdout = result.stdout || "", stderr = result.stderr || "";
  // Pacman's empty orphan query returns 1 without a diagnostic.
  if (result.status !== 0 && !(empty && result.status === 1 && !stdout.trim() && !stderr.trim())) {
    throw new Error(program + " " + args.join(" ") + " failed (" + (result.signal || result.status) + ")"
      + (stderr.trim() ? ": " + stderr.trim() : ""));
  }
  return new Set(stdout.split(/\r?\n/u).filter(Boolean));
}

export function withBuildDependencies<T>(callback: () => T, run: Runner = spawn): T {
  let before = command(run, pacman, ["-Qq"], true);
  const desktop = Bun.env.WAYLAND_DISPLAY || Bun.env.DISPLAY;
  const elevate = desktop && fs.existsSync("/usr/bin/pkexec") ? "/usr/bin/pkexec" : "/usr/bin/sudo";
  if (!before.has("libsecret")) {
    command(run, elevate, [pacman, "-S", "--needed", "--noconfirm", "--", "libsecret"]);
    before = command(run, pacman, ["-Qq"], true);
  }
  const missing = dependencies.filter(name => !before.has(name));
  if (!missing.length) return callback();
  const failures: unknown[] = [];
  let added = new Set<string>(), value!: T;
  try {
    command(run, elevate, [pacman, "-S", "--asdeps", "--needed", "--noconfirm", "--", ...missing]);
  } catch (error) { failures.push(error); }
  try {
    // Snapshot before the build so later package transactions cannot enter our cleanup set.
    added = new Set([...command(run, pacman, ["-Qq"], true)].filter(name => !before.has(name)));
  } catch (error) { failures.push(error); }
  if (!failures.length) {
    try { value = callback(); }
    catch (error) { failures.push(error); }
  }
  try {
    while (added.size) {
      const orphans = command(run, pacman, ["-Qdtq"], true, true);
      const removable = [...added].filter(name => orphans.has(name));
      if (!removable.length) break;
      // Remove only transaction-owned leaves; a second pass can collect their new orphan dependencies.
      command(run, elevate, [pacman, "-R", "--noconfirm", "--", ...removable]);
      for (const name of removable) added.delete(name);
    }
  } catch (error) { failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, failures.map(error => String(error)).join("; "));
  return value;
}
