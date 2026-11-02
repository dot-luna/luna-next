import type { LunaInfo } from "@luna/api";

export function formatInfo(info: LunaInfo): string {
  return [info.ascii.trimEnd(), "", `Luna ${info.version}`, info.description].join("\n");
}
