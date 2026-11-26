import { metadata } from "@/lib/files.ts";
import { quickshell } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";
import { lockPresentation } from "./presentation.ts";
import { lockSettingsSchema, type LockSettings } from "./schema.ts";
import type { LockRenderer, LockState } from "./context.ts";

const statuses = ["stopped", "idle", "locking", "locked"];

/** Drives the lock shell over IPC; authentication and unlocking are never exposed here. */
class LockRuntime {
  ipc({
    context,
    method,
    args,
    allowFailure,
  }: {
    context: LockRenderer;
    method: string;
    args?: string[];
    allowFailure?: boolean;
  }) {
    return quickshell.ipc({ context, target: "lock", method, args, label: "Lock", allowFailure });
  }

  /** A failed status call means no shell is listening, which reports as stopped. */
  async state(context: LockRenderer): Promise<LockState> {
    const response = await this.ipc({ context, method: "status", allowFailure: true });
    const status = response.code !== 0 ? "stopped" : response.stdout;
    if (!statuses.includes(status))
      throw new ApiError("COMMAND_FAILED", `Unexpected lock status: ${status}`);
    return {
      running: status !== "stopped",
      status: status as LockState["status"],
      shellDirectory: context.shellDirectory,
      configFile: context.configFile,
    };
  }

  /** Daemonize the shell with settings, a theme snapshot and the launcher it runs on idle. */
  async start({ context, settings }: { context: LockRenderer; settings: LockSettings }) {
    if (!context.launcher || !(await metadata(context.launcher))?.isFile())
      throw new ApiError("INVALID_PATH", "Build/install the Luna CLI or supply a lock launcher");
    const args = [context.launcher, "lock", "--config", context.configFile];
    if (context.repository) args.push("--install-dir", context.repository);
    const env = {
      ...context.env,
      LUNA_LOCK_SETTINGS: JSON.stringify(settings),
      LUNA_LOCK_THEME: JSON.stringify(await lockPresentation.theme({ context, settings })),
      LUNA_LOCK_COMMAND: JSON.stringify(args),
      ...(await lockPresentation.identity(context)),
    };
    await quickshell.command({
      context: { ...context, env },
      args: ["--no-color", "--daemonize", "--no-duplicate", "-p", context.shellDirectory],
      label: "Lock",
    });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const current = await this.state(context);
      if (current.running) return current;
      await Bun.sleep(50);
    }
    throw new ApiError("COMMAND_FAILED", "Lock did not become ready; inspect the Quickshell log");
  }

  /** The shell arbitrates stop against lock requests in its event loop; never kill a secure lock. */
  async stop(context: LockRenderer) {
    if (!(await this.state(context)).running) return this.state(context);
    const response = await this.ipc({ context, method: "stop" });
    if (response.stdout !== "ok")
      throw new ApiError("CONFLICT", "Unlock the session before stopping or restarting Lock");
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const current = await this.state(context);
      if (!current.running) return current;
      await Bun.sleep(50);
    }
    throw new ApiError("COMMAND_FAILED", "Lock did not stop; its process has been left intact");
  }

  /**
   * A requested lock is not secure until the compositor acknowledges coverage of every output.
   * An idle request that the shell declines because the user already resumed reports idle.
   */
  async acquire({ context, idle }: { context: LockRenderer; idle: boolean }) {
    const response = await this.ipc({ context, method: idle ? "lockIdle" : "lock" });
    if (response.stdout !== "ok")
      throw new ApiError("COMMAND_FAILED", `Lock request rejected: ${response.stdout}`);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const current = await this.state(context);
      if (current.status === "locked" || (idle && current.status === "idle")) return current;
      if (current.status === "idle" || current.status === "stopped") break;
      await Bun.sleep(50);
    }
    // A failed readiness check must never tear down a possibly secure session lock.
    throw new ApiError(
      "COMMAND_FAILED",
      "The compositor did not confirm the session lock; inspect the Quickshell log",
    );
  }

  /** Apply settings with a fresh theme snapshot to the running shell. */
  async reload({ context, settings }: { context: LockRenderer; settings: LockSettings }) {
    const response = await this.ipc({
      context,
      method: "reload",
      args: [
        JSON.stringify(settings),
        JSON.stringify(await lockPresentation.theme({ context, settings })),
      ],
    });
    if (response.stdout !== "ok")
      throw new ApiError("COMMAND_FAILED", `Lock rejected settings: ${response.stdout}`);
    return this.state(context);
  }

  /** Settings the running shell currently applies, used to roll back a rejected reload. */
  async snapshot(context: LockRenderer) {
    const response = await this.ipc({ context, method: "snapshot" });
    try {
      return lockSettingsSchema.parse(JSON.parse(response.stdout));
    } catch (error) {
      throw new ApiError("COMMAND_FAILED", `Invalid lock snapshot: ${String(error)}`);
    }
  }
}

export const lockRuntime = new LockRuntime();
