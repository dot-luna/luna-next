import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const [name, ...args] = Bun.argv.slice(2);
const statePath = Bun.env.LUNA_TEST_CLIPBOARD_STATE!;
const log = Bun.env.LUNA_TEST_CLIPBOARD_LOG!;
const state = JSON.parse(readFileSync(statePath, "utf8"));
appendFileSync(log, JSON.stringify({ name, args, pid: process.pid, parent: process.ppid }) + "\n");
if (state.fail === `${name}:${args[0] ?? ""}`) {
  console.error("fixture command failed");
  process.exit(7);
}
const save = () => writeFileSync(statePath, JSON.stringify(state));
const input =
  name === "cliphist" || name === "file" || name === "wl-copy"
    ? Buffer.from(await Bun.stdin.arrayBuffer())
    : Buffer.alloc(0);

if (name === "cliphist") {
  const id = input.toString().split("\t")[0];
  const entry = state.entries.find((entry: { id: string }) => entry.id === id);
  if (args[0] === "list") {
    if (!state.entries.length) {
      console.error("please store something first");
      process.exit(1);
    }
    for (const item of state.entries) console.log(`${item.id}\t${item.name}`);
  } else if (args[0] === "decode") {
    if (!entry) {
      console.error("entry no longer exists");
      process.exit(1);
    }
    process.stdout.write(Buffer.from(entry.data, "base64"));
  } else if (args[0] === "delete") {
    state.entries = state.entries.filter((item: { id: string }) => item.id !== id);
    save();
  } else if (args[0] === "store") {
    state.entries.unshift({
      id: String(++state.nextId),
      name: "promoted",
      data: input.toString("base64"),
    });
    save();
  } else if (args[0] === "wipe") {
    state.entries = [];
    save();
  } else process.exit(8);
} else if (name === "file") {
  console.log(
    state.entries.find((entry: { data: string }) => entry.data === input.toString("base64"))
      ?.mime ?? "application/octet-stream",
  );
} else if (name === "wl-copy") {
  writeFileSync(Bun.env.LUNA_TEST_CLIPBOARD_COPY!, input);
  if (state.forkOwner) {
    const owner = Bun.spawn([process.execPath, "--eval", "await Bun.sleep(2000)"], {
      stdout: "inherit",
      stderr: "inherit",
    });
    owner.unref();
  }
} else if (name === "hyprctl") {
  if (args.includes("activewindow")) console.log(JSON.stringify(state.window));
  else if (args.includes("layers")) {
    const shown = state.menuFrames > 0;
    state.menuFrames = Math.max(0, state.menuFrames - 1);
    save();
    console.log(
      JSON.stringify({ screen: { levels: { "3": shown ? [{ namespace: "luna-menu" }] : [] } } }),
    );
  } else if (args[0] === "eval") {
    // Execute the real guard and key-state Lua against a fake compositor, including focus races.
    const address = JSON.stringify(state.evalAddress ?? state.window.address);
    const script =
      `hl = { get_active_window = function() return {address=${address}} end,
      dsp = { send_key_state = function(args) return args end },
      dispatch = function(args)
        print(args.mods .. ":" .. args.state)
        return {ok=${!state.dispatchFailure}, error="fixture dispatcher failed"}
      end }\n` + args[1];
    const result = Bun.spawnSync([Bun.env.LUNA_TEST_CLIPBOARD_LUA!, "-"], {
      stdin: Buffer.from(script),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      process.stderr.write(result.stderr);
      process.exit(1);
    }
    appendFileSync(Bun.env.LUNA_TEST_CLIPBOARD_KEYS!, result.stdout);
    console.log("ok");
  } else process.exit(8);
} else if (name === "wl-paste") {
  const timer = setInterval(() => {}, 1000);
  process.on("SIGTERM", () => {
    clearInterval(timer);
    process.exit(0);
  });
} else process.exit(8);
