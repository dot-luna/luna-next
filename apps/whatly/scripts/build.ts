#!/usr/bin/env bun
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { main, paths, run, safePath, state } from "./common.ts";

/** Build only in Luna's disposable workspace; publish nothing until staging succeeds. */
export function build(): void {
  const locations = paths();
  for (const directory of [locations.clone, locations.build]) safePath(directory);
  const prepared = state();
  if (
    run(["git", "-C", locations.clone, "rev-parse", "HEAD"], undefined, Bun.env, true) !==
    prepared.revision
  ) {
    throw new Error("Whatly's workspace belongs to a different Git revision.");
  }
  fs.writeFileSync(locations.marker, JSON.stringify({ ...prepared, built: false }) + "\n");
  const output = path.join(locations.build, ".luna-output");
  const staging = path.dirname(locations.stage);
  for (const directory of [output, staging]) {
    safePath(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  }

  // The generic workspace excludes .git. Resolve the submodule from the clean clone
  // and check out its recorded commit here, where upstream CMake may modify it.
  const submodulePath = "src/libnotify-qt";
  const entry = run(
    ["git", "-C", locations.clone, "ls-tree", "HEAD", "--", submodulePath],
    undefined,
    Bun.env,
    true,
  );
  const revision = /^160000 commit ([a-f0-9]{40,64})\t/u.exec(entry)?.[1];
  if (!revision) throw new Error("Whatly must record its libnotify-qt submodule revision.");
  const url = run(
    [
      "git",
      "-C",
      locations.clone,
      "config",
      "--file",
      ".gitmodules",
      "--get",
      "submodule.src/libnotify-qt.url",
    ],
    undefined,
    Bun.env,
    true,
  );
  if (!url.startsWith("https://"))
    throw new Error("Whatly's notification submodule must use HTTPS.");
  const submodule = path.join(locations.build, submodulePath);
  safePath(submodule);
  fs.rmSync(submodule, { recursive: true, force: true });
  run(["git", "clone", "--no-checkout", "--", url, submodule]);
  run(["git", "-C", submodule, "checkout", "--detach", revision]);

  run([
    "cmake",
    "-S",
    locations.build,
    "-B",
    output,
    "-G",
    "Ninja",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_INSTALL_PREFIX=/usr",
  ]);
  run(["cmake", "--build", output, "--parallel", String(Math.min(os.availableParallelism(), 4))]);
  // Upstream install destinations are absolute, so --prefix cannot redirect them.
  run(["cmake", "--install", output], undefined, { ...Bun.env, DESTDIR: staging });
  safePath(path.join(locations.stage, "bin/whatly"));
  if (!fs.statSync(path.join(locations.stage, "bin/whatly")).isFile())
    throw new Error("Whatly did not install its executable.");
  fs.writeFileSync(locations.marker, JSON.stringify({ ...prepared, built: true }) + "\n");
}

if (import.meta.main) main(build);
