import { readdir, readFile } from "node:fs/promises";
import { join } from "pathe";
import { metadata } from "@/lib/files.ts";
import { ApiError } from "@/lib/response.ts";
import { versionSchema } from "@/modules/self/schema.ts";

/** Release scripts are named migrations/v<from>-v<to>.<ext>; README.md is the only other entry. */
const filename = /^v(\d+\.\d+\.\d+)-v(\d+\.\d+\.\d+)\.[a-zA-Z0-9]+$/u;

class MigrationPlanner {
  /** Require one unambiguous, complete forward chain before executing any script. */
  async plan({ repository, from, to }: { repository: string; from: string; to: string }) {
    if (!versionSchema.safeParse(from).success || !versionSchema.safeParse(to).success)
      throw new ApiError("INVALID_METADATA", "Migration versions must be x.y.z");
    if (this._compare({ left: from, right: to }) > 0)
      throw new ApiError("INVALID_ARGUMENT", `Cannot migrate backwards from ${from} to ${to}`);
    const directory = join(repository, "migrations");
    const info = await metadata(directory);
    if (info && !info.isDirectory())
      throw new ApiError("INVALID_PATH", "Migrations must be an ordinary directory");
    const edges = new Map<string, { from: string; to: string; path: string }>();
    for (const name of info ? await readdir(directory) : []) {
      if (name === "README.md") continue;
      const match = filename.exec(name);
      if (
        !match ||
        !versionSchema.safeParse(match[1]).success ||
        !versionSchema.safeParse(match[2]).success
      )
        throw new ApiError("INVALID_METADATA", `Invalid migration filename: ${name}`);
      const start = match[1]!;
      const end = match[2]!;
      if (this._compare({ left: start, right: end }) >= 0 || edges.has(start))
        throw new ApiError(
          "INVALID_METADATA",
          `Migration must have one forward successor: ${name}`,
        );
      edges.set(start, { from: start, to: end, path: join(directory, name) });
    }
    const plan = [];
    let current = from;
    while (current !== to) {
      const next = edges.get(current);
      if (!next || this._compare({ left: next.to, right: to }) > 0)
        throw new ApiError("INVALID_METADATA", `Missing migration from v${current} towards v${to}`);
      const file = await metadata(next.path);
      if (
        !file?.isFile() ||
        !(file.mode & 0o111) ||
        !(await readFile(next.path, "utf8")).startsWith("#!")
      )
        throw new ApiError(
          "INVALID_PATH",
          `Migration needs an executable file and shebang: ${next.path}`,
        );
      plan.push(next);
      current = next.to;
    }
    return plan;
  }

  /** Numeric x.y.z comparison: -1, 0 or 1. */
  private _compare({ left, right }: { left: string; right: string }) {
    const a = left.split(".").map(BigInt);
    const b = right.split(".").map(BigInt);
    for (let i = 0; i < 3; i++) {
      if (a[i]! < b[i]!) return -1;
      if (a[i]! > b[i]!) return 1;
    }
    return 0;
  }
}

export const migrationPlanner = new MigrationPlanner();
