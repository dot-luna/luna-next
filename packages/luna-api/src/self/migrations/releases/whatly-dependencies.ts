import { readFile, readdir } from "node:fs/promises";
import { join } from "pathe";
import { z } from "zod";
import { readCatalog } from "../../../apps/catalog.ts";
import { metadata } from "../../../lib/files.ts";
import { ApiError } from "../../../lib/response.ts";
import type { InstallContext } from "../../install/command.ts";
import { readPackages } from "../../install/packages.ts";

const eventSchema = z.object({
  type: z.string(),
  time: z.iso.datetime(),
  id: z.string().optional(),
  message: z.string().optional(),
  args: z.array(z.string()).optional(),
  exitCode: z.number().optional(),
});
type Installation = { start: number; end: number; targets: string[] };

/** Only successful commands explicitly logged under Luna's Whatly install establish ownership. */
async function installations(context: InstallContext) {
  const root = join(context.env.LUNA_STATE_HOME_DIR!, "install-logs");
  const found: Installation[] = [];
  for (const name of await readdir(root)) {
    const file = join(root, name, "events.jsonl");
    if (!(await metadata(join(root, name)))?.isDirectory() || !(await metadata(file))?.isFile())
      continue;
    let whatly = false;
    const commands = new Map<string, { start: number; targets: string[] }>();
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      const parsed = eventSchema.safeParse(value);
      if (!parsed.success) continue;
      const event = parsed.data;
      if (event.type === "progress" && event.message?.startsWith("Installing "))
        whatly = event.message === "Installing whatly...";
      if (
        whatly &&
        event.type === "command" &&
        event.id &&
        event.args?.slice(0, 6).join(" ") === "sudo pacman -S --needed --noconfirm --"
      )
        commands.set(event.id, { start: Date.parse(event.time), targets: event.args.slice(6) });
      if (event.type === "exit" && event.id && event.exitCode === 0) {
        const command = commands.get(event.id);
        if (command) found.push({ ...command, end: Date.parse(event.time) });
      }
    }
  }
  return found;
}

/** Cross-check package-manager history: pre-existing packages and later explicit requests are retained. */
export function whatlyOwnedPackages(options: { source: string; installations: Installation[] }) {
  const owned = new Set<string>();
  let whatly = false;
  for (const line of options.source.split("\n")) {
    const record = /^\[([^\]]+)\] \[(PACMAN|ALPM)\] (.*)$/u.exec(line);
    if (!record) continue;
    const message = record[3]!;
    if (record[2] === "PACMAN" && message.startsWith("Running '")) {
      const command = message.slice(9, -1).split(/\s+/u);
      const separator = command.indexOf("--");
      const targets =
        separator >= 0
          ? command.slice(separator + 1)
          : command.slice(1).filter((word) => !word.startsWith("-"));
      const time = Date.parse(record[1]!);
      whatly = options.installations.some(
        (installation) =>
          time >= installation.start - 1000 &&
          time <= installation.end + 1000 &&
          targets.join(" ") === installation.targets.join(" ") &&
          command.includes("-S"),
      );
      if (
        !whatly &&
        command.some((arg) => arg.startsWith("-S") || arg === "--sync" || arg === "--asexplicit")
      )
        for (const target of targets) owned.delete(target.replace(/^.*\//u, ""));
    }
    if (record[2] !== "ALPM") continue;
    const action = /^(installed|removed|reinstalled) ([a-zA-Z0-9@._+-]+) /u.exec(message);
    if (action) {
      owned.delete(action[2]!);
      if (whatly && action[1] === "installed") owned.add(action[2]!);
    }
  }
  return owned;
}

/** Drop candidates needed or optionally used by anything outside the removal set, transitively. */
export function removablePackages(options: {
  source: string;
  candidates: Set<string>;
  protected: Set<string>;
}) {
  const users = new Map<string, string[]>();
  let name = "";
  let field = "";
  const seen = new Map<string, Set<string>>();
  for (const line of options.source.split("\n")) {
    const value = /^([A-Za-z ]+?)\s+: (.*)$/u.exec(line);
    if (value) {
      field = value[1]!.trim();
      if (field === "Name") {
        name = value[2]!.trim();
        users.set(name, []);
        seen.set(name, new Set());
      }
    }
    if (
      name &&
      ["Required By", "Optional For"].includes(field) &&
      (value || /^\s+\S/u.test(line))
    ) {
      seen.get(name)!.add(field);
      const names = (value ? value[2]! : line)
        .trim()
        .split(/\s+/u)
        .filter((item) => item && item !== "None");
      users.get(name)!.push(...names);
    }
  }
  const result = new Set([...options.candidates].filter((name) => !options.protected.has(name)));
  for (const name of result)
    if (seen.get(name)?.size !== 2)
      throw new ApiError("INVALID_METADATA", `Missing pacman dependency information for ${name}`);
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of result)
      if (users.get(name)!.some((user) => !result.has(user))) {
        result.delete(name);
        changed = true;
      }
  }
  return [...result].sort();
}

/** Remove only proven Whatly-owned packages; never run a global orphan sweep or recursive removal. */
export async function removeWhatlyDependencies(context: InstallContext) {
  const records = await installations(context);
  if (!records.length) {
    context.progress("Keeping dependencies without a recorded Whatly installation.");
    return;
  }
  const path = (await context.execute(["pacman-conf", "LogFile"])).stdout.trim();
  if (!path.startsWith("/")) throw new ApiError("INVALID_PATH", "Invalid pacman log path");
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    context.progress(
      "Keeping dependencies because their package installation history is unavailable.",
    );
    return;
  }
  const owned = whatlyOwnedPackages({ source, installations: records });
  if (!owned.size) return;
  const installed = new Set((await context.execute(["pacman", "-Qq"])).stdout.trim().split(/\s+/u));
  const candidates = new Set([...owned].filter((name) => installed.has(name)));
  if (!candidates.size) return;
  const recipes = await readPackages(context, false);
  const protectedPackages = new Set(
    [...recipes.before_cli, ...recipes.after_cli, ...recipes.later, ...recipes.mise].map(
      (item) => item.name,
    ),
  );
  for (const app of await readCatalog(context)) {
    protectedPackages.add(app.manifest.name);
    for (const dependency of app.manifest.deps ?? []) protectedPackages.add(dependency.name);
  }
  const details = await context.execute(["pacman", "-Qi", "--", ...candidates]);
  const targets = removablePackages({
    source: details.stdout,
    candidates,
    protected: protectedPackages,
  });
  if (!targets.length) return;
  context.progress(`Removing unused Whatly dependencies: ${targets.join(", ")}...`);
  // Pacman checks hard dependencies again under its transaction lock; do not use -Rdd/-Rc/-Rs.
  await context.execute(["sudo", "pacman", "-R", "--noconfirm", "--", ...targets]);
}
