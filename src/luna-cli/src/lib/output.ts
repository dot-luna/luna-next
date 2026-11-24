import type { ApiResponse } from "@luna/api";
import { createLogger } from "./logger.ts";

type CommandResponse<T> =
  | ApiResponse<T>
  | { succes: false; err: "INVALID_ARGUMENT" | "INTERNAL_ERROR"; errMessage: string };

/** Show strings as-is, null as an empty line, and other values as indented JSON. */
export function renderValue(value: unknown): string {
  return value === null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/**
 * One invocation's stdout, diagnostics, and exit status. Results go to stdout; JSON mode
 * suppresses diagnostic logs entirely. `writeOut`, `writeErr`, and `progress` may be passed
 * as detached callbacks.
 */
export class Output {
  /** Exit status for the invocation; `response` and `report` set it from the latest result. */
  exitCode = 0;
  private readonly _stdout = Bun.stdout.writer();
  private readonly _logger;

  constructor(readonly json: boolean) {
    this._logger = json ? undefined : createLogger();
  }

  writeOut = (text: string) => {
    this._stdout.write(text);
    this._stdout.flush();
  };

  writeErr = (text: string) => {
    this._logger?.error(text.trimEnd());
  };

  progress = (message: string) => {
    this._logger?.info(message);
  };

  /** Print a response and set the exit status. JSON mode serializes it unchanged and never calls `render`. */
  response<T>(response: CommandResponse<T>, render: (data: T) => string = renderValue): void {
    if (this.json) this.writeOut(JSON.stringify(response) + "\n");
    else if (response.succes) this.writeOut(render(response.data) + "\n");
    else this._logger?.error({ code: response.err }, response.errMessage);
    this.exitCode = response.succes ? 0 : 1;
  }

  /** Print a batch report; a successful response with `completed: false` still exits 1. */
  report<T extends { completed: boolean }>(response: ApiResponse<T>, render: (data: T) => string) {
    this.response(response, render);
    if (response.succes && !response.data.completed) this.exitCode = 1;
  }
}
