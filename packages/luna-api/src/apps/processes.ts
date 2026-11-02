import { readdir, readFile, readlink, stat } from "node:fs/promises";
import { basename, join } from "pathe";
import { ApiError } from "../lib/response.ts";
import type { InstallContext } from "../self/install/command.ts";
import type { CatalogApp } from "./catalog.ts";

export interface AppProcess {
  pid: number;
  parent: number;
  executable: string;
  started: string;
}
export interface ProcessControl {
  list: () => Promise<AppProcess[]>;
  signal: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
  pause: (milliseconds: number) => Promise<void>;
  now: () => number;
  self: number;
}

/** Inspect executable identity and UID, never substring-match arbitrary command lines. */
export async function userProcesses(root = "/proc"): Promise<AppProcess[]> {
  const processes: AppProcess[] = [];
  for (const name of await readdir(root)) {
    if (!/^\d+$/u.test(name)) continue;
    try {
      const directory = join(root, name);
      if ((await stat(directory)).uid !== process.getuid?.()) continue;
      const details = await readFile(join(directory, "stat"), "utf8");
      const fields = details.slice(details.lastIndexOf(")") + 2).split(" ");
      const executable = basename(
        (await readlink(join(directory, "exe"))).replace(/ \(deleted\)$/u, ""),
      );
      processes.push({
        pid: Number(name),
        parent: Number(fields[1]),
        started: fields[19]!,
        executable,
      });
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw error;
    }
  }
  return processes;
}

/** Warn, close declared app executables and force-kill stragglers; never terminate an ancestor hosting setup. */
export async function closeApp(
  context: InstallContext,
  app: CatalogApp,
  control: ProcessControl = {
    list: () => userProcesses(),
    signal: (pid, signal) => process.kill(pid, signal),
    pause: (ms) => Bun.sleep(ms),
    now: () => Date.now(),
    self: process.pid,
  },
) {
  const names = app.manifest.processes ?? [];
  if (!names.length) return;
  const all = await control.list();
  const ancestors = new Set<number>();
  let current = control.self;
  while (current && !ancestors.has(current)) {
    ancestors.add(current);
    current = all.find((item) => item.pid === current)?.parent ?? 0;
  }
  const matches = all.filter((item) => names.includes(item.executable));
  if (matches.some((item) => ancestors.has(item.pid)))
    throw new ApiError(
      "CONFLICT",
      `${app.id} is hosting this installer. Retry from a separate terminal so setup can close it safely.`,
    );
  if (!matches.length) return;
  context.progress(
    `Closing ${app.id} in 5 seconds. Save your work; it will be force-killed if necessary.`,
  );
  await control.pause(5000);
  const remaining = async () =>
    (await control.list()).filter((item) =>
      matches.some(
        (previous) =>
          previous.pid === item.pid &&
          previous.started === item.started &&
          previous.executable === item.executable,
      ),
    );
  const targets = await remaining();
  context.log.event({ type: "close-app", app: app.id, pids: targets.map((item) => item.pid) });
  const ids = new Set(targets.map((item) => item.pid));
  const signal = (item: AppProcess, value: "SIGTERM" | "SIGKILL") => {
    try {
      control.signal(item.pid, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  for (const item of targets.filter((item) => !ids.has(item.parent))) signal(item, "SIGTERM");
  const graceful = control.now() + 3000;
  while ((await remaining()).length && control.now() < graceful) await control.pause(100);
  const stuck = await remaining();
  if (stuck.length) {
    context.progress(`Force-killing ${app.id}...`);
    context.log.event({ type: "force-kill-app", app: app.id, pids: stuck.map((item) => item.pid) });
    for (const item of stuck) signal(item, "SIGKILL");
  }
  const deadline = control.now() + 2000;
  while ((await remaining()).length) {
    if (control.now() >= deadline)
      throw new ApiError(
        "CONFLICT",
        `${app.id} is still running after termination; check the install logs and retry.`,
      );
    await control.pause(100);
  }
}
