import { openSync, closeSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import type { GitIdentity } from "@luna/api";

async function terminalQuestion(question: string) {
  // Bash owns this short terminal read; Bun cannot retain a pending TTY read after setup.
  // The question is an argument, and the answer is data: neither is evaluated as shell code.
  const child = Bun.spawn(
    [
      "bash",
      "-c",
      'IFS= read -r -p "$1" value </dev/tty || exit 1; printf "%s" "$value"',
      "luna-git-identity",
      question,
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "inherit" },
  );
  const [answer, status] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return status === 0 ? answer.trim() : "";
}

/** Use the controlling terminal when install.sh was piped into Bash. */
export async function requestGitIdentity(current: Partial<GitIdentity>): Promise<GitIdentity> {
  if (!process.stdin.isTTY) {
    try {
      closeSync(openSync("/dev/tty", "r"));
    } catch {
      // The API returns INPUT_REQUIRED when no terminal or explicit identity is available.
      return { name: current.name ?? "", email: current.email ?? "" };
    }
    return {
      name: current.name || (await terminalQuestion("Git user name: ")),
      email: current.email || (await terminalQuestion("Git email: ")),
    };
  }
  const prompt = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try {
    return {
      name: current.name || (await prompt.question("Git user name: ")).trim(),
      email: current.email || (await prompt.question("Git email: ")).trim(),
    };
  } finally {
    prompt.close();
  }
}
