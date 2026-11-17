import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "pathe";
import { metadata } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { executable, runtimeDirectory, type ClipboardContext } from "./context.ts";

// The supervisor owns only these two watchers. If either exits or the session stops,
// it reaps both; the persistent flock prevents duplicate pairs without process-name matching.
const supervisor = `
text_pid=
image_pid=
cleanup() {
  trap - EXIT INT TERM
  for pid in "$text_pid" "$image_pid"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' INT TERM
"$1" --type text --watch "$2" store >/dev/null &
text_pid=$!
"$1" --type image --watch "$2" store >/dev/null &
image_pid=$!
kill -0 "$text_pid" "$image_pid" 2>/dev/null || exit 1
printf 'ready\\n'
wait -n "$text_pid" "$image_pid"
`;

/** Start one session watcher pair. History belongs to cliphist; closing the picker leaves it running. */
export async function start(context: ClipboardContext) {
  const wlPaste = executable(context, "wl-paste");
  const cliphist = executable(context, "cliphist");
  const flock = executable(context, "flock");
  const bash = executable(context, "bash");
  const setsid = executable(context, "setsid");
  const directory = await runtimeDirectory(context);
  const lock = join(directory, "watch.lock");
  const info = await metadata(lock);
  if (info && !info.isFile())
    throw new ApiError("INVALID_PATH", "Clipboard watcher lock must be an ordinary file");
  const log = await open(
    join(directory, "watch.log"),
    constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const child = Bun.spawn(
      [
        setsid,
        flock,
        "--no-fork",
        "--exclusive",
        "--nonblock",
        "--conflict-exit-code",
        "73",
        lock,
        bash,
        "-c",
        supervisor,
        "luna-clipboard",
        wlPaste,
        cliphist,
      ],
      {
        env: context.env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: log.fd,
      },
    );
    const reader = child.stdout.getReader();
    let timer: ReturnType<typeof setTimeout>;
    try {
      const ready = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ApiError("COMMAND_FAILED", "Clipboard watcher did not start")),
            3000,
          );
        }),
      ]);
      if (ready.done) {
        const code = await child.exited;
        if (code !== 73)
          throw new ApiError(
            "COMMAND_FAILED",
            `Clipboard watcher failed (${code}); see ${directory}/watch.log`,
          );
      } else if (new TextDecoder().decode(ready.value).trim() !== "ready") {
        throw new ApiError("COMMAND_FAILED", "Unexpected clipboard watcher response");
      }
      child.unref();
      return { running: true };
    } catch (error) {
      child.kill();
      await child.exited;
      throw error;
    } finally {
      clearTimeout(timer!);
      await reader.cancel();
    }
  } finally {
    await log.close();
  }
}
