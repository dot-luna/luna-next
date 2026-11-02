#!/usr/bin/env bun
/**
 * Create the Luna profile inside the normal Linux Chromium user-data directory.
 * Run with system Bun: bun apps/chromium/scripts/create-profile.ts
 *
 * Steps:
 * 1. Resolve Chromium's standard environment overrides and the stable Luna subfolder.
 * 2. Return immediately when Luna/Preferences exists, without looking up Git or writing files.
 * 3. For a new profile, require Chromium to be closed and read global Git user.name.
 * 4. Create private profile files with that display name, without configuring extensions/theme.
 *
 * The folder stays Luna when Git's name changes. Default and other profile files are untouched.
 * setup-profile.ts registers the new profile with Chromium when it first opens it explicitly.
 * This is a standalone Bun script; it needs Git and ordinary Linux filesystem commands.
 */

export function run(args: string[]): string {
  const result = Bun.spawnSync(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  });
  if (!result.success)
    throw new Error(`${args[0]}: ${result.stderr.toString().trim() || result.exitCode}`);
  return result.stdout.toString().trim();
}

function test(flag: string, path: string): boolean {
  const result = Bun.spawnSync(["test", flag, path]);
  if (result.exitCode > 1) throw new Error(`Cannot inspect ${path}`);
  return result.exitCode === 0;
}

function profileRoot(): string {
  const base =
    Bun.env.CHROME_CONFIG_HOME ||
    Bun.env.XDG_CONFIG_HOME ||
    (Bun.env.HOME ? `${Bun.env.HOME}/.config` : "");
  const root = Bun.env.CHROME_USER_DATA_DIR || (base ? `${base}/chromium` : "");
  if (
    !root.replace(/\/+$/u, "") ||
    !root.startsWith("/") ||
    // oxlint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/u.test(root) ||
    root.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("Chromium's user-data directory must be an absolute path without '..'.");
  }
  return root.replace(/\/+$/u, "");
}

function checkPath(path: string): void {
  let current = "";
  for (const part of path.split("/").filter(Boolean)) {
    current += `/${part}`;
    if (
      test("-L", current) ||
      (test("-e", current) && !test("-d", current) && !test("-f", current))
    ) {
      throw new Error(`Expected a regular file or directory: ${current}`);
    }
  }
}

export async function createProfile() {
  const root = profileRoot();
  const directory = `${root}/Luna`;
  const preferences = `${directory}/Preferences`;
  checkPath(preferences);
  if (test("-f", preferences)) return { created: false, directory };
  run(["mkdir", "-p", "-m", "700", "--", root]);
  const lock = `${root}/.luna-setup.lock`;
  run(["mkdir", "-m", "700", "--", lock]);
  try {
    if (test("-f", preferences)) return { created: false, directory };
    for (const marker of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      const path = `${root}/${marker}`;
      if (test("-e", path) || test("-L", path))
        throw new Error("Close Chromium before creating Luna's profile.");
    }
    if (test("-e", directory))
      throw new Error(`Refusing to replace an incomplete profile: ${directory}`);
    const name = run(["git", "config", "--global", "--includes", "--get", "user.name"]);
    // oxlint-disable-next-line no-control-regex
    if (!name || /[\x00-\x1f\x7f]/u.test(name))
      throw new Error("Set a nonempty global Git user.name first.");
    run(["mkdir", "-m", "700", "--", directory]);
    await Bun.write(
      preferences,
      `${JSON.stringify({ profile: { name, using_default_name: false } }, null, 2)}\n`,
    );
    run(["chmod", "600", "--", preferences]);
    return { created: true, directory, name };
  } finally {
    run(["rmdir", "--", lock]);
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await createProfile()));
  } catch (error) {
    console.error(`Create Chromium profile: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
