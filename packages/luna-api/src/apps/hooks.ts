import { $ } from "bun";
import { childPath, safePath } from "../files.ts";
import { checked } from "../process.ts";
import { ApiError } from "../response.ts";
import type { AppInfo, Context, Hook } from "./types.ts";

export async function validateHooks(app: AppInfo, hooks: readonly Hook[]): Promise<void> {
  for (const hook of hooks) {
    for (const script of app.manifest.hooks?.[hook] ?? []) {
      const path = childPath(app.directory, script);
      await safePath(path);
      if (!(await Bun.file(path).stat()).isFile()) throw new ApiError("INVALID_HOOK", `Hook is not a file: ${path}`);
      if ((await $`test -x ${path}`.quiet().nothrow()).exitCode !== 0) throw new ApiError("INVALID_HOOK", `Hook must be executable: ${path}`);
      if (await Bun.file(path).slice(0, 2).text() !== "#!") throw new ApiError("INVALID_HOOK", `Hook requires a shebang: ${path}`);
    }
  }
}

export async function hooks(context: Context, app: AppInfo, hook: Hook, env = context.env): Promise<void> {
  for (const script of app.manifest.hooks?.[hook] ?? []) {
    const path = childPath(app.directory, script);
    await safePath(path);
    context.logger.info({ app: app.id, hook }, "Running app hook");
    await checked(context, [path], app.directory, false, env);
  }
}
