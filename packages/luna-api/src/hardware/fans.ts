import { respond } from "../lib/response.ts";
import { readFanState, setFanTargets } from "./acer.ts";
import type { HardwareContext } from "./context.ts";
import type { FanTargets, HardwareWriteOptions } from "./types.ts";

export function createFans(context: HardwareContext) {
  return {
    /** Read the driver's last accepted requests. This does not measure fan motion or RPM. */
    get: () => respond(() => readFanState(context)),
    /**
     * Apply both targets once: 0 is automatic, 1–100 manual; 100,100 selects maximum.
     * Requires explicit authorization and the installed helper. Errors can leave partial effects;
     * matching cached readback is not proof of physical fan response. No settings are restored.
     */
    set: (input: FanTargets, options?: HardwareWriteOptions) =>
      setFanTargets(context, input, options),
  };
}
