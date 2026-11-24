import type { LunaInfo } from "@luna/api";
import { version as cliVersion } from "../../../package.json";

export function formatInfo(info: LunaInfo): string {
  return [
    info.ascii.trimEnd(),
    "",
    `Luna CLI ${cliVersion}`,
    ...(info.version !== cliVersion ? [`Checkout ${info.version}`] : []),
    info.description,
  ].join("\n");
}
