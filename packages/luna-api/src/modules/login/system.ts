import { dirname, join } from "pathe";
import { metadata, readOptional } from "@/lib/files.ts";
import { ordinaryParents } from "@/lib/paths.ts";
import { capture } from "@/lib/process.ts";
import { ApiError } from "@/lib/response.ts";
import type { LoginContext } from "./context.ts";

class LoginSystem {
  private _privileged(context: LoginContext, args: string[]) {
    return context.systemRoot === "/" && process.getuid?.() !== 0 ? ["sudo", "--", ...args] : args;
  }

  async command(context: LoginContext, args: string[]) {
    const result = await capture({ args: this._privileged(context, args), env: context.env });
    if (result.code !== 0)
      throw new ApiError(
        "COMMAND_FAILED",
        result.stderr || result.stdout || `${args[0]} failed (${result.code})`,
      );
    return result.stdout.trim();
  }

  /** A system-wide lock also serializes installs from different user accounts. */
  async locked<T>(context: LoginContext, operation: () => Promise<T>) {
    const lock = join(context.systemRoot, "run/lock/luna-login.lock");
    await ordinaryParents(lock);
    if ((await metadata(lock))?.isSymbolicLink())
      throw new ApiError("INVALID_PATH", "SDDM's Login lock cannot be a symbolic link");
    await this.command(context, ["mkdir", "-p", "--", dirname(lock)]);
    const child = Bun.spawn(
      this._privileged(context, [
        "flock",
        "--exclusive",
        "--nonblock",
        lock,
        "bash",
        "-c",
        'printf "locked\\n"; read -r',
      ]),
      { env: context.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    const reader = child.stdout.getReader();
    const ready = await reader.read();
    reader.releaseLock();
    if (ready.done || !new TextDecoder().decode(ready.value).startsWith("locked")) {
      await child.exited;
      throw new ApiError(
        "CONFLICT",
        "Another Login installation holds the system lock, or privilege acquisition failed",
      );
    }
    try {
      return await operation();
    } finally {
      child.stdin.write("done\n");
      child.stdin.end();
      await child.exited;
    }
  }

  /** Stage beside the native file, preserving its mode and refusing observed external edits. */
  async writeConfig({
    context,
    source,
    expected,
    stagedSource,
  }: {
    context: LoginContext;
    source: string;
    expected: string | null;
    stagedSource: string;
  }) {
    await ordinaryParents(context.sddmConfigFile);
    const info = await metadata(context.sddmConfigFile);
    if (info && (!info.isFile() || info.isSymbolicLink()))
      throw new ApiError("INVALID_PATH", "SDDM's main config must be an ordinary file");
    if ((await readOptional(context.sddmConfigFile)) !== expected)
      throw new ApiError("CONFLICT", "SDDM configuration changed externally");
    if (source === expected) return;
    const directory = dirname(context.sddmConfigFile);
    await this.command(context, ["mkdir", "-p", "--", directory]);
    const stage = await this.command(context, [
      "mktemp",
      "-d",
      join(directory, ".luna-login-XXXXXX"),
    ]);
    try {
      await this.command(context, [
        "install",
        "-m",
        ((info?.mode ?? 0o644) & 0o777).toString(8),
        "--",
        stagedSource,
        join(stage, "config"),
      ]);
      if ((await readOptional(context.sddmConfigFile)) !== expected)
        throw new ApiError("CONFLICT", "SDDM configuration changed externally");
      await this.command(context, [
        "mv",
        "--no-target-directory",
        "--",
        join(stage, "config"),
        context.sddmConfigFile,
      ]);
    } finally {
      await this.command(context, ["rm", "-rf", "--", stage]);
    }
  }
}
export const loginSystem = new LoginSystem();
