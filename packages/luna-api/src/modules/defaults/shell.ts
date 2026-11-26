import { realpath } from "node:fs/promises";
import { ApiError } from "@/lib/response.ts";
import type { InstallContext } from "@/modules/self/install/command.ts";

type ShellContext = Pick<InstallContext, "env" | "execute">;

class LoginShell {
  executable({ context, value }: { context: Pick<ShellContext, "env">; value: string }) {
    return Bun.which(value, { PATH: context.env.PATH });
  }

  /** The account record is authoritative; SHELL can still describe an older login session. */
  async current({ context, uid = process.getuid?.() }: { context: ShellContext; uid?: number }) {
    if (uid === undefined)
      throw new ApiError("INVALID_ENVIRONMENT", "Login shells require Linux user accounts");
    const fields = (await context.execute(["getent", "passwd", String(uid)])).stdout
      .trim()
      .split(":");
    const user = fields[0];
    if (
      fields.length !== 7 ||
      Number(fields[2]) !== uid ||
      !user ||
      user.startsWith("-") ||
      /\s/u.test(user)
    )
      throw new ApiError("INVALID_ENVIRONMENT", "Cannot resolve the current login account");
    let shell = fields[6]!;
    try {
      shell = await realpath(shell);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { user, shell: shell || null, uid };
  }

  /**
   * Validate registration before any preference writes; `apply` runs `sudo chsh` only when the
   * shell differs, and the change takes effect at the next login.
   */
  async prepare({
    context,
    value,
    shellsFile = "/etc/shells",
    uid,
  }: {
    context: ShellContext;
    /** Executable name or absolute path; links resolve before comparison. */
    value: string;
    shellsFile?: string;
    uid?: number;
  }) {
    const executable = this.executable({ context, value });
    if (!executable)
      throw new ApiError(
        "INVALID_ARGUMENT",
        `Install the login shell before selecting it: ${value}`,
      );
    const selected = await realpath(executable);
    const account = await this.current({ context, uid });
    if (account.uid === 0)
      throw new ApiError("INVALID_ENVIRONMENT", "Set the login shell as a normal Linux user");
    if (selected !== account.shell && !(await this._registered(shellsFile)).includes(selected))
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${value} must be listed in /etc/shells before selecting it`,
      );
    return {
      selected,
      async apply() {
        if (selected !== account.shell)
          await context.execute(["sudo", "chsh", "--shell", selected, "--", account.user]);
      },
    };
  }

  /** Canonical paths of registered shells; entries that no longer exist become null. */
  private async _registered(shellsFile: string) {
    const registered = (await Bun.file(shellsFile).text())
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("/"));
    return Promise.all(
      registered.map(async (path) => {
        try {
          return await realpath(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
      }),
    );
  }
}

export const loginShell = new LoginShell();
