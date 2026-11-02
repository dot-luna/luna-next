import { join } from "pathe";
import { readOptional, writeFile } from "../../lib/files.ts";
import { ApiError } from "../../lib/response.ts";
import { quote } from "../../install/report.ts";
import type { InstallContext } from "./command.ts";

async function startupBlock(context: InstallContext, path: string, lines: string[]) {
  const previous = await readOptional(path);
  const begin = "# BEGIN LUNA MISE",
    end = "# END LUNA MISE";
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

/** Evaluate activation in each new interactive shell, rather than saving setup's PATH. */
export async function setupMise(context: InstallContext) {
  await context.execute(["mise", "--cd", context.home, "reshim"]);
  const executable = Bun.which("mise", { PATH: context.env.PATH });
  if (!executable)
    throw new ApiError("INVALID_ENVIRONMENT", "Mise is unavailable after installing its tools");
  const data =
    context.env.MISE_DATA_DIR ||
    join(context.env.XDG_DATA_HOME || join(context.home, ".local/share"), "mise");
  const defaults = `if [[ -z \${MISE_DATA_DIR:-} ]]; then export MISE_DATA_DIR=${quote(data)}; fi`;
  const zshHome = context.env.ZDOTDIR || context.home;
  // Zsh's Luna include can precede our .zshrc block. Initialize paths before either activates Mise.
  await startupBlock(context, join(zshHome, ".zshenv"), [defaults]);
  for (const shell of ["bash", "zsh"]) {
    const lines = [
      "case $- in *i*)",
      ...(shell === "bash" ? [defaults] : []),
      "  if ! typeset -f _mise_hook >/dev/null 2>&1; then",
      `    eval "$(${quote(executable)} activate ${shell})"`,
      "  fi",
      ";; esac",
    ];
    await startupBlock(
      context,
      join(shell === "zsh" ? zshHome : context.home, `.${shell}rc`),
      lines,
    );
  }
}
