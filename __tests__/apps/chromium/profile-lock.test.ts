import { afterEach, expect, test } from "bun:test";
import { lstat, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { requireIdle } from "../../../apps/chromium/src/profile-lock.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "luna-chromium-lock-"));
  roots.push(root);
  const child = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" });
  await child.exited;
  return { root, dead: child.pid };
}
async function markers(root: string, owner: string, socket = join(root, "missing-socket")) {
  await symlink(owner, join(root, "SingletonLock"));
  await symlink("cookie", join(root, "SingletonCookie"));
  await symlink(socket, join(root, "SingletonSocket"));
}

test("recovery removes stale local symlinks only and is safe to retry", async () => {
  const { root, dead } = await fixture();
  const target = join(root, "cookie");
  await Bun.write(target, "keep the target");
  await markers(root, `${hostname()}-${dead}`);
  await requireIdle(root);
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"])
    await expect(lstat(join(root, name))).rejects.toHaveProperty("code", "ENOENT");
  expect(await Bun.file(target).text()).toBe("keep the target");
  await requireIdle(root);
});

test("live, foreign-host, malformed and missing owners retain every marker", async () => {
  for (const kind of ["live", "foreign", "malformed", "missing"]) {
    const { root, dead } = await fixture();
    const owner =
      kind === "live"
        ? `${hostname()}-${process.pid}`
        : kind === "foreign"
          ? `other-${hostname()}-${dead}`
          : "unknown";
    await markers(root, owner);
    if (kind === "missing") await rm(join(root, "SingletonLock"));
    await expect(requireIdle(root)).rejects.toThrow("Close Chromium");
    expect(await readlink(join(root, "SingletonCookie"))).toBe("cookie");
    if (kind !== "missing") expect(await readlink(join(root, "SingletonLock"))).toBe(owner);
  }
});

test("a listening socket or unexpected marker type blocks recovery even with an exited owner", async () => {
  const { root, dead } = await fixture();
  const path = join(root, "socket");
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    await markers(root, `${hostname()}-${dead}`, path);
    await expect(requireIdle(root)).rejects.toThrow("Close Chromium");
    expect(await readlink(join(root, "SingletonCookie"))).toBe("cookie");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await rm(join(root, "SingletonCookie"));
  await Bun.write(join(root, "SingletonCookie"), "do not delete");
  await expect(requireIdle(root)).rejects.toThrow("unexpected type");
  expect(await Bun.file(join(root, "SingletonCookie")).text()).toBe("do not delete");
  expect(await readlink(join(root, "SingletonLock"))).toBe(`${hostname()}-${dead}`);
});
