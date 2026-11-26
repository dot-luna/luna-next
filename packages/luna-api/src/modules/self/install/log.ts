import {
  appendFileSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "pathe";
import { hasControlCharacters } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";

/**
 * One private, durable directory per operation under LUNA_STATE_HOME_DIR/install-logs:
 * events.jsonl, separate stdout/stderr files per command and a final summary.json.
 * Writes are synchronous, so each event is written in order before the operation continues.
 */
export class InstallLog {
  readonly directory: string;
  readonly file: string;
  readonly failures: Record<string, unknown>[] = [];
  private _sequence = 0;

  constructor(home: string, env: Record<string, string>) {
    const state =
      env.LUNA_STATE_HOME_DIR || join(env.XDG_STATE_HOME || join(home, ".local/state"), "luna");
    if (!isAbsolute(state) || resolve(state) === "/" || hasControlCharacters(state))
      throw new ApiError("INVALID_PATH", "Install log state path must be absolute and non-root");
    const root = join(state, "install-logs");
    // Refuse linked or non-directory ancestors before creating private log files beneath them.
    let parent = root;
    while (parent !== "/") {
      try {
        if (!lstatSync(parent).isDirectory())
          throw new ApiError("INVALID_PATH", `Log parent must be an ordinary directory: ${parent}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      parent = dirname(parent);
    }
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.directory = mkdtempSync(join(root, new Date().toISOString().replaceAll(":", "-") + "-"));
    chmodSync(this.directory, 0o700);
    this.file = join(this.directory, "events.jsonl");
    writeFileSync(this.file, "", { mode: 0o600 });
    this.event({ type: "start" });
  }

  event(value: Record<string, unknown>) {
    appendFileSync(this.file, JSON.stringify({ time: new Date().toISOString(), ...value }) + "\n");
  }

  /** Create fresh output files for the next command and record its arguments. */
  command(args: string[], cwd: string) {
    const id = String(++this._sequence).padStart(4, "0");
    const stdout = join(this.directory, id + ".stdout.log");
    const stderr = join(this.directory, id + ".stderr.log");
    writeFileSync(stdout, "", { mode: 0o600, flag: "wx" });
    writeFileSync(stderr, "", { mode: 0o600, flag: "wx" });
    this.event({ type: "command", id, args, cwd, stdout, stderr });
    return { id, stdout, stderr };
  }

  /** Replace summary.json; the last call describes the operation's outcome. */
  finish(result: unknown) {
    writeFileSync(join(this.directory, "summary.json"), JSON.stringify(result, null, 2) + "\n", {
      mode: 0o600,
    });
  }
}
