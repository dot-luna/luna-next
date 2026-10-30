const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { test } = require("node:test");
const { installFile, installDesktopEntry } = require("../src/build.cjs");
const { fixture, assertRestored } = require("./fixtures.cjs");

const buildScript = path.resolve(__dirname, "../src/build.cjs");
const version = "v0.1.6-nightly.20261029.3892";
const runBuild = `
const { main } = require(process.argv[1]);
try {
  main((callback) => {
    try { return callback(); }
    finally { require("node:fs").writeFileSync(process.env.LUNA_TEST_DEPS_CLEANED, "cleaned"); }
  });
} catch (error) {
  console.error("t3code: " + error.message);
  process.exitCode = 1;
}
`;

function buildFixture(t) {
  const f = fixture(t);
  const bin = path.join(f.root, "tools");
  const home = path.join(f.root, "home");
  const dataHome = path.join(f.root, "shared app data");
  const log = path.join(f.root, "pnpm.jsonl");
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(home, ".local/bin"), { recursive: true });
  fs.writeFileSync(path.join(home, ".local/bin/luna"), '#!/bin/sh\ntest "$1 $2 $3" = "theme apply t3code" || exit 8\n', { mode: 0o755 });
  // pnpm is replaced and package transactions are bypassed; preparation and installation execute.
  fs.writeFileSync(
    path.join(bin, "pnpm"),
    `#!${process.execPath}
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const settings = fs.readFileSync("packages/contracts/src/settings.ts", "utf8");
const patched = fs.readFileSync("apps/web/src/index.css", "utf8").includes("border-radius: 0 !important");
assert.equal(settings.includes("lunaDefaults"), false);
fs.appendFileSync(process.env.LUNA_TEST_LOG, JSON.stringify({ args, cwd: process.cwd(), patched }) + "\\n");
if (args[0] === "install") {
  assert.deepEqual(args, ["install", "--frozen-lockfile"]);
  assert.equal(patched, false);
  process.exit(process.env.LUNA_TEST_BUILD_MODE === "fail-install" ? 9 : 0);
}
assert.equal(patched, true);
assert.deepEqual(args.slice(0, 5), ["exec", "vp", "run", "dist:desktop:linux", "--build-version"]);
assert.equal(fs.existsSync("packages/contracts/src/luna-defaults.json"), false);
assert.ok(fs.readFileSync("apps/web/src/index.css", "utf8").includes("border-radius: 0 !important"));
const output = args[args.indexOf("--output-dir") + 1];
if (process.env.LUNA_TEST_BUILD_MODE === "fail-build") process.exit(23);
if (process.env.LUNA_TEST_BUILD_MODE === "interrupt") {
  process.stdout.write("LUNA_TEST_BUILD_READY\\n");
  setInterval(() => {}, 1000);
} else {
const launch = 'console.log(JSON.stringify({ args: process.argv.slice(1), autoUpdate: process.env.T3CODE_DISABLE_AUTO_UPDATE, launcher: process.env.T3CODE_DESKTOP_LAUNCHER_PATH, appImage: process.env.APPIMAGE ?? null, appDir: process.env.APPDIR ?? null }))';
const quote = (text) => "'" + text.replaceAll("'", "'\\\\''") + "'";
const artifact = "#!/bin/sh\\nexec " + quote(process.execPath) + " -e " + quote(launch) + ' -- "$@"\\n';
const names = process.env.LUNA_TEST_BUILD_MODE === "none"
  ? ["T3-Code-test-aarch64.AppImage"]
  : process.env.LUNA_TEST_BUILD_MODE === "multiple"
    ? ["T3-Code-one-x86_64.AppImage", "T3-Code-two-x86_64.AppImage"]
    : ["T3-Code-test-x86_64.AppImage"];
for (const name of names) fs.writeFileSync(path.join(output, name), artifact);
}
`,
    { mode: 0o755 },
  );
  const installed = path.join(dataHome, "luna-next/t3code/T3-Code.AppImage");
  const launcher = path.join(home, ".local/bin/t3code");
  const desktop = path.join(dataHome, "applications/com.t3tools.T3Code.desktop");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    HOME: home,
    XDG_DATA_HOME: dataHome,
    LUNA_PACKAGE_VERSION: version,
    LUNA_TEST_LOG: log,
    LUNA_TEST_DEPS_CLEANED: path.join(f.root, "dependencies-cleaned"),
  };
  return {
    ...f,
    env,
    installed,
    launcher,
    desktop,
    run: (mode = "success") =>
      spawnSync(process.execPath, ["-e", runBuild, buildScript], {
        cwd: f.root,
        env: { ...env, LUNA_TEST_BUILD_MODE: mode },
        encoding: "utf8",
      }),
    calls: () =>
      fs
        .readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
  };
}

function assertBuildCleanup(f) {
  assertRestored(f);
  assert.equal(fs.existsSync(path.join(f.root, ".luna-next-build.lock")), false);
  const build = f.calls().find((call) => call.args[0] === "exec");
  if (build) {
    const output = build.args[build.args.indexOf("--output-dir") + 1];
    assert.equal(fs.existsSync(output), false, "temporary artifacts are removed");
  }
}

test("builds the selected release and launches the installed AppImage with managed settings", (t) => {
  const f = buildFixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const calls = f.calls();
  assert.deepEqual(
    calls.map((call) => call.patched),
    [false, true],
  );
  assert.deepEqual(calls[1].args.slice(0, 6), [
    "exec",
    "vp",
    "run",
    "dist:desktop:linux",
    "--build-version",
    version.slice(1),
  ]);
  assert.ok(calls.every((call) => call.cwd === f.root));
  for (const file of [f.installed, f.launcher]) {
    assert.equal(fs.statSync(file).mode & 0o777, 0o755);
  }
  const desktop = fs.readFileSync(f.desktop, "utf8");
  assert.ok(desktop.includes(`Exec="${f.launcher}" %U\n`));
  assert.ok(desktop.includes("Name=T3 Code\n"));
  assert.ok(desktop.includes("Categories=Development;IDE;\n"));
  assert.doesNotMatch(desktop, /^(NoDisplay|Hidden)=true$/m);
  assert.equal(fs.statSync(f.desktop).mode & 0o777, 0o644);
  assert.deepEqual(fs.readdirSync(path.dirname(f.desktop)), ["com.t3tools.T3Code.desktop"]);
  const launch = spawnSync(f.launcher, ["--one", "a value", "literal;$text"], {
    env: {
      ...f.env,
      APPIMAGE: "/old/app.AppImage",
      APPDIR: "/old/mount",
      T3CODE_DISABLE_AUTO_UPDATE: "false",
    },
    encoding: "utf8",
  });
  assert.equal(launch.status, 0, launch.stderr);
  assert.deepEqual(JSON.parse(launch.stdout), {
    args: ["--one", "a value", "literal;$text"],
    autoUpdate: "true",
    launcher: f.launcher,
    appImage: null,
    appDir: null,
  });
  assertBuildCleanup(f);
});

for (const mode of ["fail-install", "fail-build", "none", "multiple"]) {
  test(`${mode} preserves the installed app and launcher and restores the checkout`, (t) => {
    const f = buildFixture(t);
    fs.mkdirSync(path.dirname(f.installed), { recursive: true });
    fs.mkdirSync(path.dirname(f.launcher), { recursive: true });
    fs.writeFileSync(f.installed, "previous AppImage", { mode: 0o754 });
    fs.writeFileSync(f.launcher, "previous launcher", { mode: 0o750 });
    fs.mkdirSync(path.dirname(f.desktop), { recursive: true });
    fs.writeFileSync(f.desktop, "previous desktop entry");
    const result = f.run(mode);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      mode === "none" || mode === "multiple" ? /exactly one x86_64 AppImage/ : /pnpm .* failed/,
    );
    assert.equal(fs.readFileSync(f.installed, "utf8"), "previous AppImage");
    assert.equal(fs.readFileSync(f.launcher, "utf8"), "previous launcher");
    assert.equal(fs.readFileSync(f.desktop, "utf8"), "previous desktop entry");
    assert.equal(fs.statSync(f.installed).mode & 0o777, 0o754);
    assert.equal(fs.statSync(f.launcher).mode & 0o777, 0o750);
    assertBuildCleanup(f);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal} during a foreground build restores sources and keeps the installed app`, async (t) => {
    const f = buildFixture(t);
    fs.mkdirSync(path.dirname(f.installed), { recursive: true });
    fs.mkdirSync(path.dirname(f.launcher), { recursive: true });
    fs.writeFileSync(f.installed, "previous AppImage");
    fs.writeFileSync(f.launcher, "previous launcher");
    // A separate process group models a terminal interrupt without signaling the test runner.
    const child = spawn(process.execPath, ["-e", runBuild, buildScript], {
      cwd: f.root,
      env: { ...f.env, LUNA_TEST_BUILD_MODE: "interrupt" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const closed = once(child, "close");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
      if (stdout.includes("LUNA_TEST_BUILD_READY")) {
        stdout = "";
        process.kill(-child.pid, signal);
      }
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const timeout = setTimeout(() => process.kill(-child.pid, "SIGKILL"), 5000);
    t.after(() => clearTimeout(timeout));
    const [code, termination] = await closed;
    assert.equal(termination, null, stderr);
    assert.equal(code, 1, stderr);
    assert.match(stderr, /pnpm .* failed/);
    assert.equal(fs.readFileSync(f.installed, "utf8"), "previous AppImage");
    assert.equal(fs.readFileSync(f.launcher, "utf8"), "previous launcher");
    assert.equal(fs.readFileSync(f.env.LUNA_TEST_DEPS_CLEANED, "utf8"), "cleaned");
    assertBuildCleanup(f);
  });
}

test("installFile replaces a destination symlink without changing its target", (t) => {
  const f = fixture(t);
  const source = path.join(f.root, "artifact");
  const target = path.join(f.root, "unrelated");
  const destination = path.join(f.root, "bin/t3code");
  fs.writeFileSync(source, "new app", { mode: 0o640 });
  fs.writeFileSync(target, "unrelated contents");
  fs.mkdirSync(path.dirname(destination));
  fs.symlinkSync(target, destination);
  installFile(source, destination);
  assert.equal(fs.lstatSync(destination).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(destination, "utf8"), "new app");
  assert.equal(fs.statSync(destination).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(target, "utf8"), "unrelated contents");
  assert.equal(fs.statSync(source).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(path.dirname(destination)), ["t3code"]);
});

test("menu installation replaces the hidden URL handler without creating a duplicate", (t) => {
  const f = fixture(t);
  const home = path.join(f.root, "home with spaces");
  const dataHome = path.join(f.root, "data");
  const applications = path.join(dataHome, "applications");
  fs.mkdirSync(applications, { recursive: true });
  const handler = path.join(applications, "com.t3tools.T3Code.desktop");
  const hidden = "[Desktop Entry]\nNoDisplay=true\nMimeType=x-scheme-handler/t3code;\n";
  fs.writeFileSync(handler, hidden);
  fs.writeFileSync(path.join(applications, "unrelated.desktop"), "unrelated");
  installDesktopEntry(home, dataHome);
  const content = fs.readFileSync(handler, "utf8");
  assert.ok(content.includes(`Exec="${home}/.local/bin/t3code" %U\n`));
  assert.doesNotMatch(content, /^NoDisplay=true$/m);
  assert.ok(content.includes("MimeType=x-scheme-handler/t3code;\n"));
  fs.writeFileSync(handler, hidden);
  installDesktopEntry(home, dataHome);
  assert.equal(fs.readFileSync(handler, "utf8"), content);
  assert.equal(fs.readFileSync(path.join(applications, "unrelated.desktop"), "utf8"), "unrelated");
  assert.deepEqual(fs.readdirSync(applications).sort(), [
    "com.t3tools.T3Code.desktop", "unrelated.desktop",
  ]);
});

test("entry point rejects a missing selected release before package transactions", (t) => {
  const f = buildFixture(t);
  const result = spawnSync(process.execPath, [buildScript], {
    cwd: f.root,
    env: { ...f.env, LUNA_PACKAGE_VERSION: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /select a release/);
  assert.equal(fs.existsSync(f.env.LUNA_TEST_LOG), false);
  assert.equal(fs.existsSync(path.join(f.root, ".luna-next-build.lock")), false);
  assertRestored(f);
});
