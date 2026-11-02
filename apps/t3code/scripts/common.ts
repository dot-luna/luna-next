#!/usr/bin/env bun
/**
 * Shared filesystem and process helpers for T3 Code's standalone Bun hooks.
 * Hooks resolve the same Luna Git app paths, lock their managed workspace, and publish
 * complete files by rename. These helpers never select a Git ref or launch T3.
 * Bun provides the standard filesystem/path APIs used here; no npm dependencies are needed.
 */
import * as fs from "node:fs";
import * as path from "node:path";

function absolute(value: string, label: string): string {
  if (!value || !path.isAbsolute(value) || path.resolve(value) === "/"
    || /[\x00-\x1f\x7f]/u.test(value) || value.split("/").includes("..")) {
    throw new Error(label + " must be an absolute non-root path without '..' or control characters.");
  }
  return path.resolve(value);
}

export function paths() {
  const home = absolute(Bun.env.HOME || "", "HOME");
  const dataHome = absolute(Bun.env.XDG_DATA_HOME || path.join(home, ".local/share"), "XDG_DATA_HOME");
  const cacheHome = absolute(Bun.env.XDG_CACHE_HOME || path.join(home, ".cache"), "XDG_CACHE_HOME");
  const data = absolute(Bun.env.LUNA_DATA_HOME_DIR || path.join(dataHome, "luna"), "LUNA_DATA_HOME_DIR");
  const cache = absolute(Bun.env.LUNA_CACHE_HOME_DIR || path.join(cacheHome, "luna"), "LUNA_CACHE_HOME_DIR");
  const app = (variable: string, fallback: string) => path.join(absolute(Bun.env[variable] || fallback, variable), "t3code");
  const clone = app("LUNA_GIT_APP_CLONE_DIR", path.join(data, "git/clone"));
  const build = app("LUNA_GIT_APP_BUILD_DIR", path.join(cache, "git/build"));
  const install = app("LUNA_GIT_APP_INSTALL_DIR", path.join(data, "apps/git"));
  const directories = [clone, build, install];
  for (let first = 0; first < directories.length; first++) {
    for (let second = first + 1; second < directories.length; second++) {
      const a = directories[first], b = directories[second];
      if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) {
        throw new Error("T3 clone, build, and install directories must not overlap.");
      }
    }
  }
  return { home, dataHome, clone, build, install, metadata: path.join(build, ".luna-build.json") };
}

export function safePath(file: string): void {
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const entry = fs.lstatSync(current);
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        throw new Error("T3 paths must be ordinary files or directories: " + current);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function run(args: string[], cwd?: string, capture = false): string {
  const result = Bun.spawnSync(args, { cwd, stdin: "inherit", stdout: capture ? "pipe" : "inherit", stderr: "inherit" });
  if (!result.success) throw new Error(args.join(" ") + " failed (" + result.exitCode + ")");
  return capture ? result.stdout!.toString().trim() : "";
}

export type BuildState = { version: string; revision: string; square: boolean; built: boolean };

export function state(): BuildState {
  const file = paths().metadata;
  safePath(file);
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as BuildState;
  if (!value.version || !value.revision || typeof value.square !== "boolean" || typeof value.built !== "boolean") {
    throw new Error("Run T3's prepare-build.ts hook first.");
  }
  if (Bun.env.LUNA_PACKAGE_VERSION && value.version !== Bun.env.LUNA_PACKAGE_VERSION) {
    throw new Error("T3's prepared workspace belongs to another selected ref.");
  }
  return value;
}

export function withLock<T>(callback: () => T): T {
  const lock = paths().build + ".lock";
  safePath(lock);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.mkdirSync(lock, { mode: 0o700 });
  try { return callback(); }
  finally { fs.rmdirSync(lock); }
}

/** Replace a complete owned file; failure before rename leaves its destination untouched. */
export function installFile(source: string, destination: string, mode: number): void {
  safePath(source);
  safePath(destination);
  if (!fs.lstatSync(source).isFile()) throw new Error("Expected a regular T3 source: " + source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(destination), ".luna-t3-"));
  try {
    const staged = path.join(temporary, "file");
    fs.copyFileSync(source, staged);
    fs.chmodSync(staged, mode);
    safePath(destination);
    fs.renameSync(staged, destination);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function main(action: () => unknown): void {
  try { action(); }
  catch (error) {
    console.error("T3 Code: " + (error as Error).message);
    process.exitCode = 1;
  }
}
