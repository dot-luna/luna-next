import type { AppInfo, BatchResult } from "luna-api";

export function appInfo(app: AppInfo): string {
  return [
    `${app.id} (${app.manifest.name})`,
    `Source: ${app.manifest.source}`,
    ...(app.manifest.version ? [`Version: ${app.manifest.version}`] : []),
    `Directory: ${app.directory}`,
    `Actions: ${app.capabilities.join(", ")}`,
  ].join("\n");
}

export function batchResult(result: BatchResult): string {
  return result.completed.map(value => {
    if (value.status) {
      const runtime = value.status.running === null ? "" : value.status.running ? ", running" : ", stopped";
      return `${value.app}: ${value.status.installed ? "installed" : "not installed"}${runtime}`;
    }
    return `${value.app}: ${result.action} complete`;
  }).join("\n");
}
