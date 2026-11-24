import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { metadata } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { themeCommand } from "./command.ts";
import type { ThemeContext } from "./context.ts";

export type PreferenceKey = "color-scheme" | "gtk-theme";

class Gsettings {
  /** Reuse the desktop bus; a private session lets dconf persist settings from a TTY/SSH shell. */
  async run({ context, args }: { context: ThemeContext; args: string[] }) {
    if (context.env.DBUS_SESSION_BUS_ADDRESS)
      return themeCommand.run({ context, args: ["gsettings", ...args] });
    const runtime = context.env.XDG_RUNTIME_DIR;
    if (runtime && (await metadata(join(runtime, "bus")))?.isSocket())
      return themeCommand.run({
        context: {
          ...context,
          env: { ...context.env, DBUS_SESSION_BUS_ADDRESS: this._busAddress(join(runtime, "bus")) },
        },
        args: ["gsettings", ...args],
      });
    if (!Bun.which("dbus-run-session", { PATH: context.env.PATH }))
      throw new ApiError(
        "INVALID_ENVIRONMENT",
        "Install dbus to configure theme appearance outside a desktop session",
      );
    // Appearance changes need no GVfs mounts or desktop file services.
    const env = { ...context.env, GIO_USE_VFS: "local" };
    const command = ["dbus-run-session", "--", "gsettings", ...args];
    if (context.log) return themeCommand.run({ context: { ...context, env }, args: command });
    // Activated dconf services can outlive the command and retain pipe descriptors.
    // Capture to temporary files so completion depends on gsettings, never daemon shutdown.
    const directory = await mkdtemp(join(tmpdir(), "luna-gsettings-"));
    try {
      const stdout = Bun.file(join(directory, "stdout"));
      const stderr = Bun.file(join(directory, "stderr"));
      const child = Bun.spawn(command, { env, stdin: "ignore", stdout, stderr });
      const status = await child.exited;
      const [output, error] = await Promise.all([stdout.text(), stderr.text()]);
      if (status !== 0)
        throw new ApiError(
          "COMMAND_FAILED",
          `gsettings failed (${status}): ${(error || output).trim()}`,
        );
      return output.trim();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  /** Read a desktop interface key as a GVariant literal; COMMAND_FAILED on an unknown scheme. */
  async get({ context, key }: { context: ThemeContext; key: PreferenceKey }) {
    // Keep GVariant literals intact so quoted or escaped GTK names survive recovery.
    const value = await this.run({ context, args: ["get", "org.gnome.desktop.interface", key] });
    if (key === "color-scheme" && !["'default'", "'prefer-dark'", "'prefer-light'"].includes(value))
      throw new ApiError("COMMAND_FAILED", `Unknown desktop appearance preference: ${value}`);
    return value;
  }

  /** Write a desktop interface key and read it back; COMMAND_FAILED when it was not saved. */
  async set({ context, key, value }: { context: ThemeContext; key: PreferenceKey; value: string }) {
    await this.run({ context, args: ["set", "org.gnome.desktop.interface", key, value] });
    if ((await this.get({ context, key })) !== value)
      throw new ApiError("COMMAND_FAILED", `Desktop ${key} preference was not saved`);
  }

  /** D-Bus addresses escape reserved characters that encodeURIComponent leaves intact. */
  private _busAddress(path: string) {
    const escaped = encodeURIComponent(path).replace(
      /[!'()*]/gu,
      (character) => "%" + character.charCodeAt(0).toString(16),
    );
    return `unix:path=${escaped}`;
  }
}

export const gsettings = new Gsettings();
