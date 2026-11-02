import pino, { type DestinationStream, type LevelWithSilent, type Logger } from "pino";
import pretty from "pino-pretty";

export type { Logger } from "pino";

export interface LoggerOptions {
  name?: string;
  level?: LevelWithSilent;
  format?: "pretty" | "json";
  color?: boolean;
  /** Override the stderr destination, for example when embedding or testing. */
  destination?: DestinationStream;
}

/** Shared Pino configuration. Logs use stderr, leaving stdout for API responses. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.destination ? undefined : Bun.stderr.writer();
  const destination = options.destination ?? { write(message: string) { sink!.write(message); sink!.flush(); } };
  const color = options.color ?? (Bun.enableANSIColors && !Bun.env.NO_COLOR);
  const prettify = pretty.prettyFactory({
    colorize: color,
    translateTime: "SYS:standard",
    ignore: "pid,hostname",
  });
  const stream = options.format === "json" ? destination : {
    write(message: string) { destination.write(prettify(message)); },
  };
  return pino({
    name: options.name ?? "luna",
    level: options.level ?? "info",
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: pino.stdSerializers.err },
  }, stream);
}
