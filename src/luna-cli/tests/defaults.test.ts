import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const entry = resolve(import.meta.dir, "../src/index.ts");
let root: string;
let repository: string;
let configFile: string;
let mimeappsFile: string;
let logFile: string;
let env: Record<string, string>;

function write(path: string, contents: string, executable = false) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode: executable ? 0o755 : 0o644 });
}

function configure(defaults: Record<string, string>) {
  write(configFile, `// CLI fixture defaults\n${JSON.stringify(defaults, null, 2)}\n`);
}

function state(): Record<string, string> {
  const defaults = readFileSync(mimeappsFile, "utf8").split("[Default Applications]\n")[1];
  return Object.fromEntries(
    (defaults ?? "")
      .split("\n[")[0]!
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const equals = line.indexOf("=");
        return [line.slice(0, equals), line.slice(equals + 1).split(";")[0]!];
      }),
  );
}

function commands(): { command: string; args: string[] }[] {
  return readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, entry, ...args], {
    cwd: root,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "luna defaults cli ' "));
  repository = join(root, "repository");
  configFile = join(repository, "installs/defaults.jsonc");
  mimeappsFile = join(root, "config/mimeapps.list");
  logFile = join(root, "commands.jsonl");
  env = {
    HOME: join(root, "home"),
    PATH: join(root, "bin"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_DATA_DIRS: join(root, "system-data"),
    LUNA_ROOT: repository,
    LUNA_DEFAULTS_TEST_LOG: logFile,
    NO_COLOR: "1",
  };
  mkdirSync(env.HOME!, { recursive: true });
  write(join(repository, "package.json"), '{"name":"@luna/test","version":"0.0.1"}');
  write(mimeappsFile, "[Default Applications]\n");
  write(logFile, "");
  write(join(env.PATH!, "viewer"), "#!/bin/sh\nexit 0\n", true);
  for (const tool of ["flock", "bash", "mv"]) symlinkSync(Bun.which(tool)!, join(env.PATH!, tool));
  for (const name of ["first", "second"]) {
    write(
      join(env.XDG_DATA_HOME!, "applications", `${name}.desktop`),
      `[Desktop Entry]\nType=Application\nName=${name}\nExec=viewer %F\nMimeType=image/png;image/jpeg;application/pdf;\n`,
    );
  }
  write(
    join(env.XDG_DATA_HOME!, "applications", "terminal.desktop"),
    "[Desktop Entry]\nType=Application\nName=Terminal\nExec=viewer\nCategories=TerminalEmulator;\n",
  );
  write(
    join(env.PATH!, "xdg-terminal-exec"),
    `#!${process.execPath}\n` +
      `import { existsSync, readFileSync } from "node:fs";\n` +
      `import { join } from "node:path";\n` +
      `if (Bun.argv.slice(2).join(" ") !== "--print-id") process.exit(9);\n` +
      `const path = join(process.env.XDG_CONFIG_HOME, "xdg-terminals.list");\n` +
      `if (existsSync(path)) {\n` +
      `  const id = readFileSync(path, "utf8").split("\\n").find(line => line.endsWith(".desktop"));\n` +
      `  if (id) console.log(id);\n` +
      `}\n`,
    true,
  );
  write(
    join(env.PATH!, "getent"),
    `#!${process.execPath}\n` +
      `if (Bun.argv[2] !== "passwd") process.exit(9);\n` +
      `console.log("fixture:x:" + process.getuid() + ":" + process.getgid() + ":Fixture:" + process.env.HOME + ":/bin/sh");\n`,
    true,
  );
  write(
    join(env.PATH!, "xdg-mime"),
    `#!${process.execPath}\n` +
      `import { appendFileSync, readFileSync } from "node:fs";\n` +
      `import { join } from "node:path";\n` +
      `const args = Bun.argv.slice(2);\n` +
      `appendFileSync(process.env.LUNA_DEFAULTS_TEST_LOG, JSON.stringify({ command: "xdg-mime", args }) + "\\n");\n` +
      `if (args[0] === "query" && args[1] === "default") {\n` +
      `  const source = readFileSync(join(process.env.XDG_CONFIG_HOME, "mimeapps.list"), "utf8");\n` +
      `  const line = source.split("\\n").find(line => line.startsWith(args[2] + "="));\n` +
      `  if (line) console.log(line.slice(line.indexOf("=") + 1).split(";")[0]);\n` +
      `} else process.exit(9);\n`,
    true,
  );
  configure({ "application/pdf": "first.desktop", "image/*": "first.desktop" });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("defaults list returns API data and human output distinguishes mixed, unset, and unavailable choices", async () => {
  configure({
    "application/pdf": "missing.desktop",
    "image/*": "first.desktop",
    "text/plain": "first.desktop",
  });
  write(mimeappsFile, "[Default Applications]\nimage/png=second.desktop;\n");
  const json = await cli(["defaults", "list", "--json"]);
  expect(json.exitCode, json.stdout + json.stderr).toBe(0);
  expect(json.stderr).toBe("");
  expect(JSON.parse(json.stdout)).toEqual({
    succes: true,
    data: [
      {
        key: "application/pdf",
        value: "missing.desktop",
        current: { "application/pdf": null },
        available: false,
      },
      {
        key: "image/*",
        value: "first.desktop",
        current: { "image/png": "second.desktop", "image/jpeg": null },
        available: true,
      },
      {
        key: "text/plain",
        value: "first.desktop",
        current: { "text/plain": null },
        available: true,
      },
    ],
  });
  const human = await cli(["defaults", "list"]);
  expect(human.exitCode, human.stdout + human.stderr).toBe(0);
  expect(human.stdout).toContain(
    "application/pdf: configured missing.desktop (unavailable); current unset",
  );
  expect(human.stdout).toContain("image/*: configured first.desktop; current mixed");
  expect(human.stdout).toContain("  image/png: second.desktop");
  expect(human.stdout).toContain("  image/jpeg: unset");
  expect(human.stdout).toContain("text/plain: configured first.desktop; current unset");
  expect(commands().every((item) => item.args[0] === "query")).toBe(true);
});

test("set changes an active default without rewriting JSONC and reset supports selected keys or all defaults", async () => {
  const original = readFileSync(configFile, "utf8");
  const set = await cli(["defaults", "set", "application/pdf", "second.desktop", "--json"]);
  expect(set.exitCode, set.stdout + set.stderr).toBe(0);
  expect(set.stderr).toBe("");
  expect(JSON.parse(set.stdout)).toEqual({
    succes: true,
    data: { applied: { "application/pdf": "second.desktop" } },
  });
  expect(state()["application/pdf"]).toBe("second.desktop");
  expect(readFileSync(configFile, "utf8")).toBe(original);

  const scoped = await cli(["defaults", "reset", "image/*", "--json"]);
  expect(scoped.exitCode, scoped.stdout + scoped.stderr).toBe(0);
  expect(JSON.parse(scoped.stdout)).toEqual({
    succes: true,
    data: { applied: { "image/png": "first.desktop", "image/jpeg": "first.desktop" } },
  });
  expect(state()).toEqual({
    "application/pdf": "second.desktop",
    "image/png": "first.desktop",
    "image/jpeg": "first.desktop",
  });

  const reset = await cli(["defaults", "reset"]);
  expect(reset.exitCode, reset.stdout + reset.stderr).toBe(0);
  expect(reset.stdout).toContain("application/pdf: first.desktop");
  expect(reset.stdout).toContain("image/png: first.desktop");
  expect(state()["application/pdf"]).toBe("first.desktop");
  expect(readFileSync(configFile, "utf8")).toBe(original);
});

test("terminal and shell are listed as distinct defaults and a terminal reset uses its desktop ID", async () => {
  configure({ terminal: "terminal.desktop", shell: "/bin/sh" });
  const listed = await cli(["defaults", "list", "--json"]);
  expect(listed.exitCode, listed.stdout + listed.stderr).toBe(0);
  expect(JSON.parse(listed.stdout)).toEqual({
    succes: true,
    data: [
      {
        key: "terminal",
        value: "terminal.desktop",
        current: { terminal: null },
        available: true,
      },
      {
        key: "shell",
        value: "/bin/sh",
        current: { shell: realpathSync("/bin/sh") },
        available: true,
      },
    ],
  });
  const reset = await cli(["defaults", "reset", "terminal", "--json"]);
  expect(reset.exitCode, reset.stdout + reset.stderr).toBe(0);
  expect(JSON.parse(reset.stdout)).toEqual({
    succes: true,
    data: { applied: { terminal: "terminal.desktop" } },
  });
  const active = await cli(["defaults", "list"]);
  expect(active.exitCode, active.stdout + active.stderr).toBe(0);
  expect(active.stdout).toContain(
    "terminal: configured terminal.desktop; current terminal.desktop",
  );
  expect(active.stdout).toContain(`shell: configured /bin/sh; current ${realpathSync("/bin/sh")}`);
});

test("explicit checkout and config flags override LUNA_ROOT and the repository defaults file", async () => {
  env.LUNA_ROOT = join(root, "missing-checkout");
  const other = join(root, "other.jsonc");
  write(other, '{"application/pdf":"second.desktop"}');
  const result = await cli([
    "defaults",
    "--install-dir",
    "./repository",
    "--config",
    "./other.jsonc",
    "reset",
    "--json",
  ]);
  expect(result.exitCode, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    succes: true,
    data: { applied: { "application/pdf": "second.desktop" } },
  });
  expect(state()).toEqual({ "application/pdf": "second.desktop" });
});

test("defaults errors preserve API failures and argument errors without mutating preferences", async () => {
  const invalidKey = await cli(["defaults", "set", "browser", "first.desktop", "--json"]);
  expect(invalidKey.exitCode).toBe(1);
  expect(JSON.parse(invalidKey.stdout)).toMatchObject({ succes: false });
  expect(invalidKey.stderr).toBe("");

  const unavailable = await cli([
    "defaults",
    "set",
    "application/pdf",
    "missing.desktop",
    "--json",
  ]);
  expect(unavailable.exitCode).toBe(1);
  expect(JSON.parse(unavailable.stdout)).toMatchObject({ succes: false });

  const missingArgument = await cli(["defaults", "set", "application/pdf", "--json"]);
  expect(missingArgument.exitCode).toBe(2);
  expect(JSON.parse(missingArgument.stdout)).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(missingArgument.stderr).toBe("");
  expect(state()).toEqual({});
  expect(commands().every((item) => item.args[0] === "query")).toBe(true);
});
