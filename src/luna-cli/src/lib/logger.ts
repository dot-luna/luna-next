import pino, { type DestinationStream, type LevelWithSilent } from "pino";
import pretty from "pino-pretty";

interface LoggerOptions {
  level?: LevelWithSilent;
  color?: boolean;
  destination?: DestinationStream;
}

/** CLI diagnostics go to stderr; NO_COLOR and FORCE_COLOR control automatic coloring. */
export function createLogger(options: LoggerOptions = {}) {
  const sink = options.destination ? undefined : Bun.stderr.writer();
  const destination = options.destination ?? {
    write(message: string) {
      sink!.write(message);
      sink!.flush();
    },
  };
  const color =
    options.color ??
    (Bun.env.NO_COLOR === undefined &&
      (Bun.env.FORCE_COLOR === undefined ? Bun.enableANSIColors : Bun.env.FORCE_COLOR !== "0"));
  // Format inline so compiled Bun executables need no worker or transport files.
  const prettify = pretty.prettyFactory({
    colorize: color,
    translateTime: "SYS:standard",
    ignore: "pid,hostname",
    singleLine: true,
  });
  return pino(
    {
      name: "luna",
      level: options.level ?? "info",
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: { err: pino.stdSerializers.err },
    },
    {
      write(message: string) {
        destination.write(prettify(message));
      },
    },
  );
}
