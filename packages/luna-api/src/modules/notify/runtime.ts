import { capture } from "@/lib/process.ts";
import { quickshell } from "@/lib/quickshell.ts";
import { ApiError } from "@/lib/response.ts";
import type { NotifyContext, NotifyState } from "./context.ts";
import { notifySettings, type NotifySnapshot } from "./settings.ts";

const label = "Notify";

/** Luna runs only while its Quickshell instance owns org.freedesktop.Notifications. */
class NotifyRuntime {
  async state(context: NotifyContext): Promise<NotifyState> {
    return {
      running: await this._running(context),
      shellDirectory: context.shellDirectory,
      configFile: context.configFile,
    };
  }

  /**
   * Start the shell daemon with snapshotted settings and wait up to 3 s for bus ownership.
   * Fails with CONFLICT when another provider or a non-owning instance is active; a shell
   * that never acquires the bus is killed before the error is returned.
   */
  async start({ context, snapshot }: { context: NotifyContext; snapshot?: NotifySnapshot }) {
    const pid = await this._instance(context);
    const provider = await this._owner(context);
    if (pid !== null && pid === provider) return;
    if (provider !== null || pid !== null)
      throw new ApiError(
        "CONFLICT",
        "Another notification provider is active. Stop it before starting Luna notifications.",
      );
    const prepared = snapshot ?? (await notifySettings.snapshot(context));
    context.env.LUNA_NOTIFY_THEME = JSON.stringify(prepared.theme);
    context.env.LUNA_NOTIFY_SETTINGS = JSON.stringify(prepared.settings);
    await quickshell.command({
      context,
      args: ["--no-color", "--daemonize", "--no-duplicate", "-p", context.shellDirectory],
      label,
    });
    try {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (await this._running(context)) return;
        await Bun.sleep(50);
      }
      throw new ApiError(
        "COMMAND_FAILED",
        "Notifications did not acquire the session bus; inspect the Quickshell log",
      );
    } catch (error) {
      await quickshell.command({
        context,
        args: ["kill", "-p", context.shellDirectory],
        label,
        allowFailure: true,
      });
      throw error;
    }
  }

  /** Kill this shell's instance if one answers; other providers are left alone. */
  async stop(context: NotifyContext) {
    if ((await this._instance(context)) !== null)
      await quickshell.command({ context, args: ["kill", "-p", context.shellDirectory], label });
  }

  async restart(context: NotifyContext) {
    // Invalid source settings must not tear down a healthy notification provider.
    const snapshot = await notifySettings.snapshot(context);
    await this.stop(context);
    await this.start({ context, snapshot });
  }

  /** Forward focus or dismiss only to a running provider; otherwise do nothing. */
  async send({ context, method }: { context: NotifyContext; method: "focus" | "dismiss" }) {
    if (await this._running(context))
      await quickshell.ipc({ context, target: "notify", method, label });
  }

  private async _instance(context: NotifyContext) {
    const result = await quickshell.ipc({
      context,
      target: "notify",
      method: "pid",
      label,
      allowFailure: true,
    });
    return result.code === 0 && /^\d+$/.test(result.stdout) ? Number(result.stdout) : null;
  }

  private async _running(context: NotifyContext) {
    const pid = await this._instance(context);
    return pid !== null && pid === (await this._owner(context));
  }

  /** Query the bus daemon directly: probing must never activate a competing provider. */
  private async _owner(context: NotifyContext) {
    const busctl = Bun.which("busctl", { PATH: context.env.PATH });
    if (!busctl)
      throw new ApiError("COMMAND_FAILED", "Install busctl to check notification ownership");
    const { code, stdout, stderr } = await capture({
      args: [
        busctl,
        "--user",
        "call",
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "GetConnectionUnixProcessID",
        "s",
        "org.freedesktop.Notifications",
      ],
      // The no-owner checks below match busctl's untranslated messages.
      env: { ...context.env, LC_ALL: "C" },
      timeout: 3000,
    });
    if (code !== 0) {
      if (
        stderr.includes("does not exist") ||
        stderr.includes("has no owner") ||
        stderr.includes("no such name")
      )
        return null;
      throw new ApiError("COMMAND_FAILED", `Cannot inspect notification bus: ${stderr.trim()}`);
    }
    const match = /^u (\d+)\s*$/.exec(stdout);
    if (!match) throw new ApiError("COMMAND_FAILED", "Invalid notification bus ownership response");
    return Number(match[1]);
  }
}

export const notifyRuntime = new NotifyRuntime();
