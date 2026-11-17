import { lstat, readlink, unlink } from "node:fs/promises";
import { connect } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";

const markers = ["SingletonSocket", "SingletonCookie", "SingletonLock"] as const;

async function snapshot(root: string) {
  return Promise.all(
    markers.map(async (name) => {
      const path = join(root, name);
      try {
        const info = await lstat(path);
        if (!info.isSymbolicLink() || info.uid !== process.getuid?.())
          throw new Error(`Close Chromium first (${name} has an unexpected type or owner).`);
        return { path, target: await readlink(path), inode: info.ino, device: info.dev };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    }),
  );
}

function ownerExited(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // Permission errors and reused PIDs are ambiguous; only a missing PID proves exit.
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function socketIdle(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ path });
    const done = (idle: boolean) => {
      socket.destroy();
      resolve(idle);
    };
    socket.once("connect", () => done(false));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      done(error.code === "ECONNREFUSED" || error.code === "ENOENT"),
    );
    socket.setTimeout(500, () => done(false));
  });
}

/**
 * Refuse active or ambiguous profiles. Recover only this user's singleton symlinks
 * for an exited PID on this host with no listening socket. Never unlink their targets.
 * This is an idle check, not a lock shared with Chromium; callers recheck before writes.
 */
export async function requireIdle(root: string): Promise<void> {
  const before = await snapshot(root);
  if (before.every((entry) => entry === null)) return;
  const lock = before[2];
  const owner = lock?.target.match(/^(.*)-([1-9][0-9]*)$/u);
  const pid = Number(owner?.[2]);
  const refuse = () =>
    new Error("Close Chromium first (singleton owner is active or cannot be verified).");
  if (
    !owner ||
    owner[1] !== hostname() ||
    !Number.isSafeInteger(pid) ||
    pid > 2147483647 ||
    !ownerExited(pid)
  )
    throw refuse();
  const socket = before[0];
  if (socket && (!socket.target.startsWith("/") || !(await socketIdle(socket.target))))
    throw refuse();
  // An intervening browser start must not have its replacement markers removed.
  const after = await snapshot(root);
  if (JSON.stringify(before) !== JSON.stringify(after) || !ownerExited(pid)) throw refuse();
  for (const entry of before) if (entry) await unlink(entry.path);
}
