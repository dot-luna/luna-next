import type { InstallFailure } from "@luna/api";

/** A partial run remains a failing CLI invocation, with actionable retries for each app. */
export function installReport(
  completed: boolean,
  installed: string[],
  failed: InstallFailure[],
  logDirectory: string,
) {
  const lines = [
    completed ? "Luna installation completed." : "Luna installation finished with failures.",
  ];
  if (installed.length) lines.push(`Installed and configured: ${installed.join(", ")}`);
  for (const failure of failed) {
    const error =
      failure.error.length > 1800
        ? failure.error.slice(0, 900) + "\n... see full logs ...\n" + failure.error.slice(-900)
        : failure.error;
    lines.push(`\n${failure.app} failed: ${error}`, `Retry: ${failure.retry}`);
  }
  lines.push(`\nLogs: ${logDirectory}`);
  return lines.join("\n");
}
