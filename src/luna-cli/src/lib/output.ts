import type { ApiResponse } from "@luna/api";
import { createLogger } from "./logger.ts";

type CommandResponse<T> =
  | ApiResponse<T>
  | { succes: false; err: "INVALID_ARGUMENT" | "INTERNAL_ERROR"; errMessage: string };

/** Print results on stdout; JSON mode suppresses diagnostic logs entirely. */
export function createOutput(json: boolean) {
  const stdout = Bun.stdout.writer();
  const logger = json ? undefined : createLogger();
  const writeOut = (text: string) => {
    stdout.write(text);
    stdout.flush();
  };
  const writeErr = (text: string) => {
    logger?.error(text.trimEnd());
  };

  return {
    writeOut,
    writeErr,
    /** JSON mode serializes the response unchanged and never calls the text renderer. */
    response<T>(response: CommandResponse<T>, render: (data: T) => string): 0 | 1 {
      if (json) writeOut(JSON.stringify(response) + "\n");
      else if (response.succes) writeOut(render(response.data) + "\n");
      else logger?.error({ code: response.err }, response.errMessage);
      return response.succes ? 0 : 1;
    },
  };
}
