import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// Each wrapper names the command explicitly, so symlink resolution cannot change
// which fake tool runs. No package manager, download, or desktop command is real.
const [name, ...args] = Bun.argv.slice(2);
const env = process.env;
appendFileSync(
  env.BOOTSTRAP_LOG!,
  JSON.stringify({ name, args, cwd: process.cwd(), repo: env.LUNA_ROOT }) + "\n",
);
const command = name === "git" && args[0] === "-C" ? args.slice(2) : args;
const operation = name === "mise" && args.includes("use") ? "use" : command[0];

function fail(message: string): never {
  console.error(message);
  process.exit(17);
}

if (env.BOOTSTRAP_FAIL_ONCE === `${name}:${operation}` && !existsSync(env.BOOTSTRAP_ONCE_MARKER!)) {
  writeFileSync(env.BOOTSTRAP_ONCE_MARKER!, "");
  console.log("discard this failed attempt's output");
  fail("temporary download failure");
}
if (name === env.BOOTSTRAP_FAIL) fail("simulated failure diagnostics");

if (name === "sudo" && args[0] !== "-v") {
  const child = Bun.spawnSync(args, { env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  process.exit(child.exitCode);
} else if (name === "git") {
  // Real-Git regressions rewrite only remote operations to a temporary local
  // repository. Local origin validation still sees the declared Luna URL.
  if (env.BOOTSTRAP_REAL_GIT) {
    const forwarded = ["ls-remote", "fetch", "pull"].includes(command[0]!)
      ? [
          "-c",
          `url.${env.BOOTSTRAP_REAL_REMOTE}.insteadOf=https://github.com/dot-luna/luna-next.git`,
          ...args,
        ]
      : args;
    const child = Bun.spawnSync([env.BOOTSTRAP_REAL_GIT, ...forwarded], {
      env,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(child.exitCode);
  }
  const state = JSON.parse(env.BOOTSTRAP_GIT ?? "{}");
  if (command[0] === env.BOOTSTRAP_GIT_FAIL) fail("simulated git failure");
  switch (command[0]) {
    case "clone": {
      const root = args.at(-1)!;
      mkdirSync(join(root, ".git"), { recursive: true });
      mkdirSync(join(root, "src/luna-cli"), { recursive: true });
      if (env.BOOTSTRAP_RACE_DEST)
        writeFileSync(join(env.BOOTSTRAP_RACE_DEST, ".personal"), "keep me");
      break;
    }
    case "rev-parse":
      console.log(
        command.includes("--verify")
          ? (state[command.at(-1) === "HEAD^{commit}" ? "head" : "selected"] ?? "a".repeat(40))
          : (state.root ?? args[1]),
      );
      break;
    case "remote":
      console.log(state.origin ?? "https://github.com/dot-luna/luna-next.git");
      break;
    case "status":
      process.stdout.write(state.changes ?? "");
      break;
    case "ls-remote":
      if (command.includes("--symref")) {
        if (!state.missing_default)
          console.log(`ref: refs/heads/${state.default ?? "master"}\tHEAD`);
      } else {
        for (const ref of command.slice(3)) {
          const [, kind, ...parts] = ref.split("/");
          const selected = (state.refs ?? { master: "heads" })[parts.join("/")];
          if (selected === kind || selected === "both") console.log(`${"a".repeat(40)}\t${ref}`);
        }
      }
      break;
    case "symbolic-ref":
      if (state.detached) process.exit(1);
      break;
    case "for-each-ref":
      process.stdout.write((state.retained_refs ?? []).join("\n"));
      break;
    case "show-ref":
      if (
        !(state.local_branches ?? ["master"]).includes(command.at(-1)!.replace("refs/heads/", ""))
      )
        process.exit(1);
      break;
  }
} else if (name === "mise" && args.includes("which")) {
  console.log(join(env.BOOTSTRAP_BIN!, "bun"));
} else if (name === "bun" && args[0] === "run") {
  const pkg = args[args.indexOf("--cwd") + 1]!;
  if (pkg === env.BOOTSTRAP_BUILD_FAIL) fail("simulated dependency build failure");
  if (pkg === "src/luna-cli") {
    mkdirSync("target", { recursive: true });
    copyFileSync(env.BOOTSTRAP_LUNA_WRAPPER!, "target/luna");
    chmodSync("target/luna", 0o755);
  } else fail("unexpected build target");
} else if (name === "sleep" && env.BOOTSTRAP_CANCEL) {
  // Signal only the installer, then remain alive until its EXIT cleanup kills us.
  process.kill(process.ppid, Number(env.BOOTSTRAP_CANCEL));
  await Bun.sleep(30_000);
} else if (name === "luna") {
  console.log("self install called");
} else if (name !== "sudo" && name !== "sleep") {
  console.log("routine output that should stay hidden");
}
