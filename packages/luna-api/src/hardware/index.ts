/**
 * On-demand Linux hardware operations for Luna's Acer Nitro ANV15-51.
 *
 * Behavior reference: https://github.com/PXDiv/Div-Acer-Manager-Max
 * If Acer controls stop working after firmware or kernel updates, check that
 * repository's latest changes and https://github.com/PXDiv/Div-Linuwu-Sense for
 * driver-interface updates. Review changes before adapting this implementation;
 * the API never downloads or applies upstream changes at runtime.
 *
 * Power state belongs to power-profiles-daemon. Acer writes require the installed
 * one-shot helper; importing this namespace starts no service or hardware work.
 */
import { createFans } from "./fans.ts";
import { createKeyboard } from "./keyboard.ts";
import { createBattery } from "./battery.ts";
import { systemContext, type HardwareContext } from "./context.ts";
import { inspectHardware } from "./inspect.ts";
import { createMetrics } from "./metrics.ts";
import { createPower } from "./power.ts";

/** Internal factory keeps test transports out of the public method options. */
export function createHardware(context: HardwareContext) {
  return {
    inspect: () => inspectHardware(context),
    power: createPower(context),
    fans: createFans(context),
    battery: createBattery(context),
    keyboard: createKeyboard(context),
    metrics: createMetrics(context),
  };
}

export const hardware = createHardware(systemContext);
