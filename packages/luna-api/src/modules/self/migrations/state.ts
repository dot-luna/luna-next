import { isAbsolute, join, resolve } from "pathe";
import { z } from "zod";
import { locked, metadata, parse, readOptional, writeFile } from "@/lib/files.ts";
import { ordinaryParents } from "@/lib/paths.ts";
import { validate } from "@/lib/validation.ts";
import { ApiError } from "@/lib/response.ts";
import type { InstallContext } from "@/modules/self/install/command.ts";

export const versionSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
const stateSchema = z.object({ repository: z.string(), version: versionSchema }).strict();

export async function checkoutVersion(repository: string) {
  const value = parse(await Bun.file(join(repository, "package.json")).text(), "Luna package");
  return validate(z.object({ version: versionSchema }), value, "Luna package").version;
}

export function stateFile(context: InstallContext) {
  const root =
    context.env.LUNA_STATE_HOME_DIR ||
    join(context.env.XDG_STATE_HOME || join(context.home, ".local/state"), "luna");
  if (!isAbsolute(root) || resolve(root) === "/")
    throw new ApiError("INVALID_PATH", "Luna state directory must be absolute and non-root");
  return join(root, "migrations.jsonc");
}

/** Serialize the entire self operation separately from the child migration runner. */
export async function selfLocked<T>(context: InstallContext, operation: () => Promise<T>) {
  const path = stateFile(context) + ".update";
  await ordinaryParents(path);
  if (await metadata(path + ".lock")) {
    const info = await metadata(path + ".lock");
    if (!info?.isFile()) throw new ApiError("INVALID_PATH", "Invalid self-update lock");
  }
  return locked({ configFile: path, env: context.env }, operation);
}

export async function readState(context: InstallContext) {
  const path = stateFile(context);
  await ordinaryParents(path);
  const info = await metadata(path);
  if (info && !info.isFile())
    throw new ApiError("INVALID_PATH", "Migration state must be a regular file");
  const source = await readOptional(path);
  if (source === null) return null;
  const state = validate(stateSchema, parse(source, path), path);
  if (state.repository !== context.repository)
    throw new ApiError("CONFLICT", "Migration state belongs to another Luna checkout");
  return state;
}

/** Persist before fetching, and after each successful script, so retries cannot skip work. */
export async function saveVersion(context: InstallContext, version: string) {
  await readState(context);
  const path = stateFile(context);
  await writeFile(
    path,
    JSON.stringify({ repository: context.repository, version }, null, 2) + "\n",
    await readOptional(path),
  );
}
