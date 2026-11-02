import { $ } from "bun";
import { createLogger } from "luna-logger";
import { createApps, type AppManifest, type CommandRequest, type CommandResult } from "../src/index.ts";

export async function sandbox() {
  const root = (await $`mktemp -d`.text()).trim();
  const repository = `${root}/repository`;
  const env: Record<string, string> = {
    HOME: `${root}/home`,
    PATH: Bun.env.PATH!,
    LUNA_NEXT_ROOT: repository,
  };
  await $`mkdir -p ${repository}/apps ${env.HOME}`.quiet();
  const calls: CommandRequest[] = [];
  let behavior = (_request: CommandRequest): CommandResult | Promise<CommandResult> => ({ exitCode: 0, stdout: "", stderr: "" });
  const options = {
    env,
    logger: createLogger({ level: "silent" }),
    run: async (request: CommandRequest) => { calls.push(request); return behavior(request); },
  };
  return {
    root, repository, env, calls, options,
    apps: createApps(options),
    behavior(fn: typeof behavior) { behavior = fn; },
    async app(id: string, manifest: AppManifest) {
      await $`mkdir -p ${repository}/apps/${id}`.quiet();
      await Bun.write(`${repository}/apps/${id}/app.conf`, JSON.stringify(manifest));
    },
    async file(path: string, contents: string, executable = false) {
      await Bun.write(path, contents);
      if (executable) await $`chmod +x ${path}`.quiet();
    },
    async cleanup() { await $`/usr/bin/rm -rf -- ${root}`.quiet(); },
  };
}
