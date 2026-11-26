import { isAbsolute, join, resolve } from "pathe";
import { locked, metadata, parse, readOptional, writeFile } from "@/lib/files.ts";
import { ordinaryParents } from "@/lib/paths.ts";
import { validate } from "@/lib/validation.ts";
import { ApiError } from "@/lib/response.ts";
import type { InstallContext } from "@/modules/self/install/command.ts";
import { checkoutPackageSchema, migrationStateSchema } from "@/modules/self/schema.ts";

/** The last applied release version, stored in LUNA_STATE_HOME_DIR/migrations.jsonc. */
class MigrationState {
  /** The release version declared by the checkout's root package.json. */
  async checkoutVersion(repository: string) {
    const value = parse(await Bun.file(join(repository, "package.json")).text(), "Luna package");
    return validate(checkoutPackageSchema, value, "Luna package").version;
  }

  path(context: InstallContext) {
    const root =
      context.env.LUNA_STATE_HOME_DIR ||
      join(context.env.XDG_STATE_HOME || join(context.home, ".local/state"), "luna");
    if (!isAbsolute(root) || resolve(root) === "/")
      throw new ApiError("INVALID_PATH", "Luna state directory must be absolute and non-root");
    return join(root, "migrations.jsonc");
  }

  /**
   * Serialize the entire self install/update. This lock is separate from the migration
   * runner's state lock, which migrations take while the self operation holds this one.
   */
  async selfLocked<T>({
    context,
    operation,
  }: {
    context: InstallContext;
    operation: () => Promise<T>;
  }) {
    const path = this.path(context) + ".update";
    await ordinaryParents(path);
    const lock = await metadata(path + ".lock");
    if (lock && !lock.isFile()) throw new ApiError("INVALID_PATH", "Invalid self-update lock");
    return locked({ configFile: path, env: context.env }, operation);
  }

  /** Null when nothing was recorded; CONFLICT when the state belongs to another checkout. */
  async read(context: InstallContext) {
    const path = this.path(context);
    await ordinaryParents(path);
    const info = await metadata(path);
    if (info && !info.isFile())
      throw new ApiError("INVALID_PATH", "Migration state must be a regular file");
    const source = await readOptional(path);
    if (source === null) return null;
    const state = validate(migrationStateSchema, parse(source, path), path);
    if (state.repository !== context.repository)
      throw new ApiError("CONFLICT", "Migration state belongs to another Luna checkout");
    return state;
  }

  /** Persist before fetching, and after each successful script, so retries cannot skip work. */
  async save({ context, version }: { context: InstallContext; version: string }) {
    await this.read(context);
    const path = this.path(context);
    await writeFile(
      path,
      JSON.stringify({ repository: context.repository, version }, null, 2) + "\n",
      await readOptional(path),
    );
  }
}

export const migrationState = new MigrationState();
