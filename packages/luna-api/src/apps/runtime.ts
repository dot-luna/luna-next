import { checked, command } from "../process.ts";
import { ApiError } from "../response.ts";
import { installed } from "./packages.ts";
import type { AppInfo, AppStatus, Context, RuntimeAction } from "./types.ts";

export async function runtime(context: Context, app: AppInfo, action: Exclude<RuntimeAction, "status">): Promise<void> {
  const argv = app.manifest.runtime?.[action];
  if (argv) {
    await checked(context, argv, app.directory);
  } else if (action === "restart" && app.manifest.runtime?.stop && app.manifest.runtime.start) {
    await checked(context, app.manifest.runtime.stop, app.directory);
    await checked(context, app.manifest.runtime.start, app.directory);
  } else {
    throw new ApiError("UNSUPPORTED_ACTION", `${app.id} does not support ${action}`);
  }
}

export async function status(context: Context, app: AppInfo): Promise<AppStatus> {
  const present = await installed(context, app);
  const argv = app.manifest.runtime?.status;
  if (!argv) return { installed: present, running: null };
  const result = await command(context, argv, app.directory, true);
  if (result.exitCode !== 0 && result.exitCode !== 3) throw new ApiError("COMMAND_FAILED", `Status command for ${app.id} failed`, { exitCode: result.exitCode });
  return { installed: present, running: result.exitCode === 0 };
}
