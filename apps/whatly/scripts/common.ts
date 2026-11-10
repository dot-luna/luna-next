import * as fs from "node:fs";
import * as path from "node:path";

export function absolute(value: string, name: string): string {
  if (
    !path.isAbsolute(value) ||
    value === "/" ||
    // oxlint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/u.test(value) ||
    value.split("/").includes("..")
  ) {
    throw new Error(
      `${name} must be an absolute non-root path without '..' or control characters.`,
    );
  }
  return path.resolve(value);
}

export function paths() {
  const home = absolute(Bun.env.HOME || "", "HOME");
  const dataHome = absolute(
    Bun.env.XDG_DATA_HOME || path.join(home, ".local/share"),
    "XDG_DATA_HOME",
  );
  const data = absolute(
    Bun.env.LUNA_DATA_HOME_DIR || path.join(dataHome, "luna"),
    "LUNA_DATA_HOME_DIR",
  );
  const cache = absolute(
    Bun.env.LUNA_CACHE_HOME_DIR || path.join(home, ".cache/luna"),
    "LUNA_CACHE_HOME_DIR",
  );
  const app = (variable: string, fallback: string) =>
    path.join(absolute(Bun.env[variable] || fallback, variable), "whatly");
  const clone = app("LUNA_GIT_APP_CLONE_DIR", path.join(data, "git/clone"));
  const build = app("LUNA_GIT_APP_BUILD_DIR", path.join(cache, "git/build"));
  const install = app("LUNA_GIT_APP_INSTALL_DIR", path.join(data, "apps/git"));
  const directories = [clone, build, install];
  for (const [index, a] of directories.entries()) {
    for (const b of directories.slice(index + 1)) {
      if (a === b || a.startsWith(b + "/") || b.startsWith(a + "/")) {
        throw new Error("Whatly clone, build, and install directories must not overlap.");
      }
    }
  }
  return {
    home,
    dataHome,
    clone,
    build,
    install,
    stage: path.join(build, ".luna-stage/usr"),
    marker: path.join(build, ".luna-build.json"),
  };
}

/** Hook paths never traverse links, including pre-existing publication destinations. */
export function safePath(file: string): void {
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const info = fs.lstatSync(current);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
        throw new Error("Whatly paths must be ordinary files or directories: " + current);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function run(
  args: string[],
  cwd?: string,
  env: NodeJS.ProcessEnv = Bun.env,
  capture = false,
): string {
  const result = Bun.spawnSync(args, {
    cwd,
    env,
    stdin: "inherit",
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  if (!result.success) throw new Error(`${args.join(" ")} failed (${result.exitCode})`);
  return capture ? result.stdout!.toString().trim() : "";
}

export function state() {
  const { marker } = paths();
  safePath(marker);
  const value = JSON.parse(fs.readFileSync(marker, "utf8")) as {
    app?: string;
    revision?: string;
    built?: boolean;
  };
  if (value.app !== "whatly" || !/^[a-f0-9]{40,64}$/u.test(value.revision || "")) {
    throw new Error("Run Whatly through Luna's managed Git installer first.");
  }
  return value;
}

/** Publish one complete owned file on its destination filesystem. */
export function installFile(source: string, destination: string, mode = 0o644): void {
  safePath(source);
  safePath(destination);
  if (!fs.lstatSync(source).isFile())
    throw new Error("Expected a regular Whatly artifact: " + source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(destination), ".luna-whatly-"));
  try {
    const staged = path.join(temporary, "file");
    fs.copyFileSync(source, staged);
    fs.chmodSync(staged, mode);
    fs.renameSync(staged, destination);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function main(action: () => void): void {
  try {
    action();
  } catch (error) {
    console.error("Whatly: " + (error as Error).message);
    process.exitCode = 1;
  }
}
