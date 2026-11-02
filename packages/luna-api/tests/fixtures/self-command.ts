import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// Package/build commands are fake. Only Git operates for real, against a local repository.
const [name, ...args] = Bun.argv.slice(2);
const env = process.env;
appendFileSync(
  env.SELF_LOG!,
  JSON.stringify({
    name,
    args,
    cwd: process.cwd(),
    repository: env.LUNA_ROOT,
    miseData: env.MISE_DATA_DIR,
  }) + "\n",
);
const command = name === "git" && args[0] === "-C" ? args.slice(2) : args;
if (env.SELF_FAIL === `${name}:${command[0]}`) {
  console.error("fixture failure diagnostics");
  process.exit(17);
}

if (name === "xdg-mime") {
  if (args[0] !== "query" || args[1] !== "default")
    throw new Error(`Unexpected xdg-mime arguments: ${args.join(" ")}`);
  process.exit(0);
} else if (name === "gsettings") {
  const key = args[2];
  if (key !== "color-scheme" && key !== "gtk-theme")
    throw new Error(`Unexpected GSettings key: ${key}`);
  const path = join(env.HOME!, key);
  if (args[0] === "set") writeFileSync(path, args.at(-1)!);
  else
    console.log(
      existsSync(path)
        ? readFileSync(path, "utf8")
        : key === "gtk-theme"
          ? "'Adwaita'"
          : "'default'",
    );
  process.exit(0);
} else if (name === "git") {
  const forwarded = ["ls-remote", "fetch", "pull"].includes(command[0]!)
    ? ["-c", `url.${env.SELF_REMOTE}.insteadOf=https://github.com/dot-luna/luna-next.git`, ...args]
    : args;
  const child = Bun.spawnSync([env.SELF_REAL_GIT!, ...forwarded], {
    env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(child.exitCode);
} else if (name === "sudo" && args[0] !== "-v") {
  const child = Bun.spawnSync(args, { env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  process.exit(child.exitCode);
} else if ((name === "pacman" || name === "yay") && env.SELF_INSTALLED_JSON) {
  const path = env.SELF_INSTALLED_JSON;
  const installed: string[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  const packages = args.slice(args.indexOf("--") + 1);
  if (args[0] === "-Qq") process.exit(installed.includes(args.at(-1)!) ? 0 : 1);
  if (args[0] === "-S")
    writeFileSync(path, JSON.stringify([...new Set([...installed, ...packages])]));
  if (args[0] === "-S" && packages.includes(env.LUNA_TEST_DESKTOP_PACKAGE!)) {
    const applications = join(env.XDG_DATA_HOME!, "applications");
    mkdirSync(applications, { recursive: true });
    writeFileSync(
      join(applications, "fixture-viewer.desktop"),
      "[Desktop Entry]\nType=Application\nName=Fixture Viewer\nExec=fixture-viewer %f\nMimeType=application/pdf;\n",
    );
  }
  process.exit(0);
} else if (name === "mise" && args[0] === "activate") {
  console.log("export LUNA_TEST_MISE_ACTIVE=1\n_mise_hook() { :; }");
  process.exit(0);
} else if (name === "mise" && args.includes("latest")) {
  const requested = args.at(-1)!.split("@")[1];
  const versions: string[] = JSON.parse(env.SELF_MISE_VERSIONS ?? "[]");
  const version = versions.find(
    (version) =>
      !requested ||
      requested === "latest" ||
      version === requested ||
      version.startsWith(requested + "."),
  );
  if (version) console.log(version);
  process.exit(0);
} else if (name === "mise" && args.includes("ls")) {
  console.log(
    JSON.stringify(
      JSON.parse(env.SELF_MISE_VERSIONS ?? "[]").map((version: string) => ({ version })),
    ),
  );
  process.exit(0);
} else if (name === "mise" && args.includes("which")) {
  console.log(join(env.SELF_BIN!, "bun"));
  process.exit(0);
} else if (name === "bun" && args[0] === "run") {
  mkdirSync("target", { recursive: true });
  writeFileSync("target/luna", "#!/bin/sh\nprintf 'fixture CLI\\n'\n");
  chmodSync("target/luna", 0o755);
}
console.log("routine command output stays captured");
