import { respond } from "../lib/response.ts";
import { readKeyboardState, setKeyboardTimeout } from "./acer.ts";
import type { HardwareContext } from "./context.ts";
import type { HardwareWriteOptions } from "./types.ts";

export function createKeyboard(context: HardwareContext) {
  return {
    /** Read the fixed 30-second timer. Null means the driver's explicit unknown value. */
    get: () => respond(() => readKeyboardState(context)),
    /**
     * Toggle the 30-second timer through the authorized helper; false does not turn lighting off.
     * Success requires matching boolean readback. A failed verification may follow a real change.
     */
    setTimeout: (input: { enabled: boolean }, options?: HardwareWriteOptions) =>
      setKeyboardTimeout(context, input, options),
  };
}
