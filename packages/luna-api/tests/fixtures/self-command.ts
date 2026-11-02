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
  JSON.stringify({ name, args, cwd: process.cwd(), repository: env.LUNA_ROOT }) + "\n",
);
const command = name === "git" && args[0] === "-C" ? args.slice(2) : args;
if (env.SELF_FAIL === `${name}:${command[0]}`) {
  console.error("fixture failure diagnostics");
  process.exit(17);
}

if (name === "gsettings") {
  const path = join(env.HOME!, "preference");
  if (args[0] === "set") writeFileSync(path, args.at(-1)!);
  else console.log(`'${existsSync(path) ? readFileSync(path, "utf8") : "default"}'`);
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
} else if (name === "mise" && args.includes("which")) {
  console.log(join(env.SELF_BIN!, "bun"));
  process.exit(0);
} else if (name === "bun" && args[0] === "run") {
  mkdirSync("target", { recursive: true });
  writeFileSync("target/luna", "#!/bin/sh\nprintf 'fixture CLI\\n'\n");
  chmodSync("target/luna", 0o755);
}
console.log("routine command output stays captured");
