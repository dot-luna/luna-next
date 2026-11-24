#!/usr/bin/env bun
/**
 * build: compile the prepared T3 workspace into one x86_64 Linux AppImage.
 * Run with system Bun after prepare-build.ts; no installed app is changed here.
 *
 * Steps:
 * 1. Read the selected build record and upstream's exact Node/pnpm tool versions.
 * 2. Temporarily install missing Arch build dependencies, retaining libsecret at runtime.
 * 3. Run the frozen pnpm install and upstream Linux packaging command through mise.
 * 4. Require one x86_64 AppImage, mark the build complete, and clean temporary dependencies.
 *
 * Failed or interrupted builds never mark their output installable. Package cleanup runs
 * within this stage even on failure; after_build must not be used as a failure-cleanup hook.
 * This script runs on Bun; T3's upstream build uses its own mise-managed Node and pnpm.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { main, paths, run, safePath, state, withLock } from "./common.ts";
import { withBuildDependencies } from "./build-deps.ts";

export function build(dependencies: typeof withBuildDependencies = withBuildDependencies): void {
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("T3 builds currently require x86_64 Linux.");
  withLock(() => {
    const locations = paths();
    const prepared = state();
    prepared.built = false;
    fs.writeFileSync(locations.metadata, JSON.stringify(prepared, null, 2) + "\n");
    const output = path.join(locations.build, "generated/artifacts");
    safePath(output);
    fs.rmSync(output, { recursive: true, force: true });
    fs.mkdirSync(output, { recursive: true });
    const upstream = JSON.parse(fs.readFileSync(path.join(locations.build, "package.json"), "utf8"));
    const node = upstream.engines?.node;
    const pnpm = /^pnpm@(\d+\.\d+\.\d+)(?:\+.*)?$/u.exec(upstream.packageManager || "")?.[1];
    if (typeof node !== "string" || !/^\d+\.\d+\.\d+$/u.test(node) || !pnpm) {
      throw new Error("T3 must declare exact Node and pnpm versions in its package.json.");
    }
    const tools = ["mise", "exec", "--yes", "node@" + node, "pnpm@" + pnpm, "--", "pnpm"];
    dependencies(() => {
      run([...tools, "install", "--frozen-lockfile"], locations.build);
      run([...tools, "exec", "vp", "run", "dist:desktop:linux", "--build-version",
        prepared.version.replace(/^v/u, ""), "--output-dir", output], locations.build);
      const artifacts = fs.readdirSync(output).filter(name => name.endsWith("-x86_64.AppImage"));
      if (artifacts.length !== 1) throw new Error("T3 must produce exactly one x86_64 AppImage.");
      const artifact = path.join(output, artifacts[0]);
      safePath(artifact);
      if (!fs.lstatSync(artifact).isFile()) throw new Error("T3 AppImage must be a regular file.");
    });
    // Dependency cleanup must succeed before after_build is allowed to publish this artifact.
    prepared.built = true;
    fs.writeFileSync(locations.metadata, JSON.stringify(prepared, null, 2) + "\n");
  });
}

if (import.meta.main) {
  // Foreground children share terminal signals; let cleanup run after they return.
  const waitForChild = () => {};
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, waitForChild);
  try { main(() => build()); }
  finally { for (const signal of ["SIGINT", "SIGTERM"] as const) process.off(signal, waitForChild); }
}
