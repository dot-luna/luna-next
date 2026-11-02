import { openSync, closeSync } from "node:fs";
import { createInterface } from "node:readline/promises";

async function terminalQuestion(question: string) {
  // Bash owns this short terminal read; Bun cannot retain a pending TTY read after setup.
  // The question is an argument, and the answer is data: neither is evaluated as shell code.
  const child = Bun.spawn(
    [
      "bash",
      "-c",
      'IFS= read -r -p "$1" value </dev/tty || exit 1; printf "%s" "$value"',
      "luna-prompt",
      question,
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "inherit" },
  );
  const [answer, status] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return status === 0 ? answer.trim() : "";
}

/** Prompt through the controlling terminal, including piped bootstrap sessions. */
export async function promptForm<T>(
  fill: (ask: (question: string) => Promise<string>) => Promise<T>,
): Promise<T | undefined> {
  if (!process.stdin.isTTY) {
    try {
      closeSync(openSync("/dev/tty", "r"));
    } catch {
      return undefined;
    }
    return fill(terminalQuestion);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try {
    return await fill(async (question) => (await prompt.question(question)).trim());
  } finally {
    prompt.close();
  }
}
