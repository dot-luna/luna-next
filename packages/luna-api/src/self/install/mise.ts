import { join } from "pathe";
import { readOptional, writeFile } from "../../lib/files.ts";
import { ApiError } from "../../lib/response.ts";
import { quote } from "../../install/report.ts";
import type { InstallContext } from "./command.ts";

/** Evaluate activation in each new interactive shell, rather than saving setup's PATH. */
export async function setupMise(context: InstallContext) {
  await context.execute(["mise", "--cd", context.home, "reshim"]);
  const executable = Bun.which("mise", { PATH: context.env.PATH });
  if (!executable)
    throw new ApiError("INVALID_ENVIRONMENT", "Mise is unavailable after installing its tools");
  const data =
    context.env.MISE_DATA_DIR ||
    join(context.env.XDG_DATA_HOME || join(context.home, ".local/share"), "mise");
  for (const shell of ["bash", "zsh"]) {
    const path = join(context.home, shell === "bash" ? ".bashrc" : ".zshrc");
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
    const block = [
      begin,
      "case $- in *i*)",
      `  if [[ -z \${MISE_DATA_DIR:-} ]]; then export MISE_DATA_DIR=${quote(data)}; fi`,
      "  if ! typeset -f _mise_hook >/dev/null 2>&1; then",
      `    eval "$(${quote(executable)} activate ${shell})"`,
      "  fi",
      ";; esac",
      end,
      "",
    ].join("\n");
    await writeFile(path, block + body, previous);
    context.log.event({ type: "mise-shell", shell, path });
  }
}
