import { join } from "pathe";
import { readOptional, writeFile } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import type { InstallContext } from "./command.ts";
import { installReport } from "./report.ts";

const begin = "# BEGIN LUNA MISE";
const end = "# END LUNA MISE";

class MiseShell {
  /** Evaluate activation in each new interactive shell, rather than saving setup's PATH. */
  async configure(context: InstallContext) {
    await context.execute(["mise", "--cd", context.home, "reshim"]);
    const executable = Bun.which("mise", { PATH: context.env.PATH });
    if (!executable)
      throw new ApiError("INVALID_ENVIRONMENT", "Mise is unavailable after installing its tools");
    const data =
      context.env.MISE_DATA_DIR ||
      join(context.env.XDG_DATA_HOME || join(context.home, ".local/share"), "mise");
    const defaults = `if [[ -z \${MISE_DATA_DIR:-} ]]; then export MISE_DATA_DIR=${installReport.quote(data)}; fi`;
    const zshHome = context.env.ZDOTDIR || context.home;
    // Zsh's Luna include can precede our .zshrc block. Initialize paths before either activates Mise.
    await this._writeBlock({ context, path: join(zshHome, ".zshenv"), lines: [defaults] });
    for (const shell of ["bash", "zsh"]) {
      const lines = [
        "case $- in *i*)",
        ...(shell === "bash" ? [defaults] : []),
        "  if ! typeset -f _mise_hook >/dev/null 2>&1; then",
        `    eval "$(${installReport.quote(executable)} activate ${shell})"`,
        "  fi",
        ";; esac",
      ];
      const path = join(shell === "zsh" ? zshHome : context.home, `.${shell}rc`);
      await this._writeBlock({ context, path, lines });
    }
  }

  /** Replace Luna's block, or prepend it, keeping the rest of the startup file unchanged. */
  private async _writeBlock({
    context,
    path,
    lines,
  }: {
    context: InstallContext;
    path: string;
    lines: string[];
  }) {
    const previous = await readOptional(path);
    let body = previous ?? "";
    const start = body.indexOf(begin);
    if (start !== -1) {
      const finish = body.indexOf(end, start);
      if (finish === -1)
        throw new ApiError("INVALID_METADATA", `Incomplete Luna Mise block: ${path}`);
      body = body.slice(0, start) + body.slice(finish + end.length).replace(/^\r?\n/u, "");
    }
    await writeFile(path, [begin, ...lines, end, ""].join("\n") + body, previous);
    context.log.event({ type: "mise-shell", path });
  }
}

export const miseShell = new MiseShell();
