const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { withPreparedSources } = require("./prepare.cjs");
const { withBuildDependencies } = require("./build-deps.cjs");

function run(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(" ")} failed (${result.signal || result.status})`);
  }
}

/** Publish complete files by rename so a failed build keeps the installed app usable. */
function installFile(source, destination, mode = 0o755) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(destination), ".t3-install-"));
  try {
    const staged = path.join(temporary, "file");
    fs.copyFileSync(source, staged);
    fs.chmodSync(staged, mode);
    fs.renameSync(staged, destination);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/** Install T3's visible launcher using the same desktop ID its URL handler maintains. */
function installDesktopEntry(home, dataHome) {
  const launcher = path.join(home, ".local/bin/t3code");
  // Desktop Exec values undergo string unescaping before argument unquoting.
  const quoted = launcher
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$")
    .replaceAll("%", "%%");
  const escaped = quoted
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  const content = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=T3 Code",
    `Exec="${escaped}" %U`,
    "Icon=com.t3tools.T3Code",
    "Terminal=false",
    "NoDisplay=false",
    "Categories=Development;IDE;",
    "StartupWMClass=t3code",
    "StartupNotify=false",
    "MimeType=x-scheme-handler/t3code;",
    "",
  ].join("\n");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "luna-t3-desktop-"));
  try {
    const source = path.join(temporary, "com.t3tools.T3Code.desktop");
    fs.writeFileSync(source, content);
    installFile(source, path.join(dataHome, "applications/com.t3tools.T3Code.desktop"), 0o644);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/** Build the selected checkout with square controls, restoring patched sources on failure. */
function build(checkout, version, dependencies = withBuildDependencies) {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("The T3 source recipe currently supports x86_64 Linux");
  }
  if (!version) throw new Error("Run luna install --git t3code to select a release");
  const home = process.env.HOME;
  if (!home || !path.isAbsolute(home) || home === "/")
    throw new Error("HOME must be an absolute user home");
  const dataHome = process.env.XDG_DATA_HOME || path.join(home, ".local/share");
  if (!path.isAbsolute(dataHome)) throw new Error("XDG_DATA_HOME must be absolute");
  const app = path.resolve(__dirname, "..");
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "luna-t3-build-"));
  // Serialise our temporary source edits, including dependency installation and restoration.
  const lock = path.join(checkout, ".luna-next-build.lock");
  let locked = false;
  try {
    fs.mkdirSync(lock);
    locked = true;
    dependencies(() => {
      run("pnpm", ["install", "--frozen-lockfile"], checkout);
      withPreparedSources(
        checkout,
        path.join(app, "config/boxy.css"),
        () => {
          run(
            "pnpm",
            [
              "exec",
              "vp",
              "run",
              "dist:desktop:linux",
              "--build-version",
              version.replace(/^v/, ""),
              "--output-dir",
              output,
            ],
            checkout,
          );
        },
      );
      const artifacts = fs.readdirSync(output).filter((name) => name.endsWith("-x86_64.AppImage"));
      if (artifacts.length !== 1)
        throw new Error("T3 build must produce exactly one x86_64 AppImage");
      installFile(
        path.join(output, artifacts[0]),
        path.join(dataHome, "luna-next/t3code/T3-Code.AppImage"),
      );
      installFile(path.join(__dirname, "t3code"), path.join(home, ".local/bin/t3code"));
      installDesktopEntry(home, dataHome);
    });
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
    if (locked) fs.rmdirSync(lock);
  }
}

function main(dependencies = withBuildDependencies) {
  // A foreground child receives the same terminal signal. Let it return so our
  // finally blocks restore sources and dependencies instead of Node exiting immediately.
  const waitForChild = () => {};
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, waitForChild);
  try {
    build(process.cwd(), process.env.LUNA_PACKAGE_VERSION, dependencies);
  } finally {
    for (const signal of ["SIGINT", "SIGTERM"]) process.off(signal, waitForChild);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`t3code: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { build, installFile, installDesktopEntry, main };
