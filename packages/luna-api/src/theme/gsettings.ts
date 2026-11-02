import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { metadata } from "../lib/files.ts";
import { ApiError } from "../lib/response.ts";
import { command, type ThemeContext } from "./context.ts";

/** Reuse the desktop bus; a private session lets dconf persist settings from a TTY/SSH shell. */
export async function gsettings(context: ThemeContext, args: string[]) {
  if (context.env.DBUS_SESSION_BUS_ADDRESS) return command(context, ["gsettings", ...args]);
  const runtime = context.env.XDG_RUNTIME_DIR;
  if (runtime && (await metadata(join(runtime, "bus")))?.isSocket()) {
    return command(
      {
        ...context,
        env: {
          ...context.env,
          DBUS_SESSION_BUS_ADDRESS: `unix:path=${encodeURIComponent(join(runtime, "bus")).replace(/[!'()*]/gu, (character) => "%" + character.charCodeAt(0).toString(16))}`,
        },
      },
      ["gsettings", ...args],
    );
  }
  if (!Bun.which("dbus-run-session", { PATH: context.env.PATH }))
    throw new ApiError(
      "INVALID_ENVIRONMENT",
      "Install dbus to configure theme appearance outside a desktop session",
    );
  // Appearance changes need no GVfs mounts or desktop file services.
  // Activated dconf services can outlive the command and retain pipe descriptors.
  // Capture to temporary files so completion depends on gsettings, never daemon shutdown.
  const directory = await mkdtemp(join(tmpdir(), "luna-gsettings-"));
  try {
    const stdout = Bun.file(join(directory, "stdout"));
    const stderr = Bun.file(join(directory, "stderr"));
    const child = Bun.spawn(["dbus-run-session", "--", "gsettings", ...args], {
      env: { ...context.env, GIO_USE_VFS: "local" },
      stdin: "ignore",
      stdout,
      stderr,
    });
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
