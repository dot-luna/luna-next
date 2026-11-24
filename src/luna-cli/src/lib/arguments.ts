import { InvalidArgumentError } from "commander";

/** Commander parser for a finite duration; blank input is rejected because `Number("")` is 0. */
export function duration(unit: "seconds" | "milliseconds") {
  return (value: string): number => {
    const parsed = Number(value);
    if (!value.trim() || !Number.isFinite(parsed))
      throw new InvalidArgumentError(`Expected a duration in ${unit}`);
    return parsed;
  };
}
