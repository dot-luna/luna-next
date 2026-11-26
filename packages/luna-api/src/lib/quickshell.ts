import { ApiError } from "./response.ts";
import { capture } from "./process.ts";

/** A resolved Quickshell application; `-p` scopes every command to this shell directory. */
export interface QuickshellContext {
  env: Record<string, string>;
  executable: string;
  shellDirectory: string;
}

class Quickshell {
  /** Find `qs` or `quickshell` on the caller's PATH; `feature` names what needs it. */
  executable({ env, feature }: { env: Record<string, string>; feature: string }) {
    const path = Bun.which("qs", { PATH: env.PATH }) ?? Bun.which("quickshell", { PATH: env.PATH });
    if (!path) throw new ApiError("COMMAND_FAILED", `Install Quickshell to use ${feature}`);
    return path;
  }

  /** Run a Quickshell subcommand with trimmed output; failures throw unless allowed. */
  async command({
    context,
    args,
    label,
    allowFailure = false,
  }: {
    context: QuickshellContext;
    args: string[];
    /** Names the feature in failure messages, such as "Bar". */
    label: string;
    allowFailure?: boolean;
  }) {
    const result = await capture({
      args: [context.executable, ...args],
      env: context.env,
      timeout: 5000,
    });
    const stdout = result.stdout.trim();
    const stderr = result.stderr.trim();
    if (result.code !== 0 && !allowFailure)
      throw new ApiError(
        "COMMAND_FAILED",
        `${label} command failed (${result.code}): ${stderr || stdout}`,
      );
    return { code: result.code, stdout, stderr };
  }

  /** Call an IPC method on `target`; `--` keeps names like `show` from parsing as subcommands. */
  ipc({
    context,
    target,
    method,
    args = [],
    label,
    allowFailure = false,
  }: {
    context: QuickshellContext;
    target: string;
    method: string;
    args?: string[];
    label: string;
    allowFailure?: boolean;
  }) {
    return this.command({
      context,
      args: ["ipc", "-p", context.shellDirectory, "call", "--", target, method, ...args],
      label,
      allowFailure,
    });
  }
}

export const quickshell = new Quickshell();
