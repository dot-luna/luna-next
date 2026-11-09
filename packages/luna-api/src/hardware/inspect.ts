import { respond } from "../lib/response.ts";
import { inspectAcer } from "./acer.ts";
import { errorMessage, optionalText, requireLinux, type HardwareContext } from "./context.ts";
import { getProperties } from "./dbus.ts";
import { inspectMetrics } from "./metrics.ts";
import { readPower } from "./power.ts";
import type { HardwareCapabilities, HardwareCapability } from "./types.ts";

async function availableWhen(operation: () => Promise<unknown>): Promise<HardwareCapability> {
  try {
    await operation();
    return { status: "available", reason: null };
  } catch (error) {
    return { status: "unavailable", reason: errorMessage(error) };
  }
}

/** Probe independent interfaces without elevation, firmware writes, or waking the GPU. */
export function inspectHardware(context: HardwareContext) {
  return respond<HardwareCapabilities>(async () => {
    requireLinux(context);
    const [manufacturer, model, acer, metrics, powerProfiles, batteryInfo] = await Promise.all([
      optionalText(context, "/sys/class/dmi/id/sys_vendor").catch(() => null),
      optionalText(context, "/sys/class/dmi/id/product_name").catch(() => null),
      inspectAcer(context),
      inspectMetrics(context),
      availableWhen(() => readPower(context)),
      availableWhen(() =>
        getProperties(context, {
          destination: "org.freedesktop.UPower",
          path: "/org/freedesktop/UPower",
          interface: "org.freedesktop.UPower",
        }),
      ),
    ]);
    return {
      machine: { manufacturer, model },
      features: { powerProfiles, batteryInfo, ...acer.features, ...metrics },
      privilegedWrites: acer.privilegedWrites,
    };
  });
}
