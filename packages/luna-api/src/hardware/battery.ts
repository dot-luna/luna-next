import { ApiError, respond } from "../lib/response.ts";
import { AcerUnavailableError, readChargeLimit, setChargeLimit } from "./acer.ts";
import { errorMessage, requireLinux, type HardwareContext } from "./context.ts";
import { callBus, getProperties } from "./dbus.ts";
import type { BatteryState, BatteryStatus, HardwareWriteOptions, ReadIssue } from "./types.ts";

const service = {
  destination: "org.freedesktop.UPower",
  path: "/org/freedesktop/UPower",
  interface: "org.freedesktop.UPower",
};
const batteryFields = ["percentage", "healthPercent", "cycles", "state"] as const;
const states: Record<number, BatteryStatus> = {
  1: "charging",
  2: "discharging",
  3: "empty",
  4: "fully-charged",
  5: "pending-charge",
  6: "pending-discharge",
};

function failedIssue(error: unknown): Omit<ReadIssue, "component"> {
  return {
    code:
      error instanceof AcerUnavailableError
        ? error.status
        : error instanceof ApiError && error.code === "INVALID_ENVIRONMENT"
          ? "unavailable"
          : "read-failed",
    message: errorMessage(error),
  };
}

function missingFields(state: BatteryState, issue: Omit<ReadIssue, "component">): void {
  for (const component of batteryFields) state.issues.push({ component, ...issue });
}

function readBatteryFields(state: BatteryState, properties: Record<string, unknown>): void {
  const percentage = properties.Percentage;
  if (
    typeof percentage === "number" &&
    Number.isFinite(percentage) &&
    percentage >= 0 &&
    percentage <= 100
  )
    state.percentage = percentage;
  else
    state.issues.push({
      component: "percentage",
      code: "read-failed",
      message: "UPower returned an invalid charge percentage",
    });

  const capacity = properties.Capacity;
  // UPower uses an unset Capacity (zero) for unavailable health, while Percentage zero is valid.
  if (typeof capacity === "number" && Number.isFinite(capacity) && capacity > 0 && capacity <= 100)
    state.healthPercent = capacity;
  else
    state.issues.push({
      component: "healthPercent",
      code: capacity === 0 || capacity === undefined ? "unknown" : "read-failed",
      message: "UPower did not report a valid battery capacity",
    });

  const cycles = properties.ChargeCycles;
  if (typeof cycles === "number" && Number.isSafeInteger(cycles) && cycles >= 0)
    state.cycles = cycles;
  else
    state.issues.push({
      component: "cycles",
      code: cycles === -1 || cycles === undefined ? "unknown" : "read-failed",
      message: "UPower did not report a valid cycle count",
    });

  const status = properties.State;
  const known = typeof status === "number" && Number.isInteger(status) ? states[status] : undefined;
  if (known) state.state = known;
  else
    state.issues.push({
      component: "state",
      code: "unknown",
      message: "UPower did not report a recognized battery state",
    });
}

async function readSystemBattery(context: HardwareContext, state: BatteryState): Promise<void> {
  try {
    const result = await callBus(context, { ...service, method: "EnumerateDevices" });
    if (
      !Array.isArray(result) ||
      result.length !== 1 ||
      !Array.isArray(result[0]) ||
      result[0].some(
        (path) =>
          typeof path !== "string" ||
          !/^\/org\/freedesktop\/UPower\/devices\/[A-Za-z0-9_]+$/u.test(path),
      )
    )
      throw new ApiError("IO_ERROR", "UPower returned invalid device paths");

    const paths = [...new Set(result[0] as string[])];
    const devices = await Promise.allSettled(
      paths.map(async (path) => {
        const properties = await getProperties(context, {
          ...service,
          path,
          interface: "org.freedesktop.UPower.Device",
        });
        if (
          !Number.isInteger(properties.Type) ||
          typeof properties.Type !== "number" ||
          properties.Type <= 0
        )
          throw new ApiError("IO_ERROR", "UPower returned an unknown device type");
        if (properties.Type !== 2) return null;
        if (typeof properties.PowerSupply !== "boolean")
          throw new ApiError("IO_ERROR", "UPower returned an invalid battery PowerSupply property");
        if (!properties.PowerSupply) return null;
        if (typeof properties.IsPresent !== "boolean")
          throw new ApiError("IO_ERROR", "UPower returned an invalid battery IsPresent property");
        return properties.IsPresent ? properties : null;
      }),
    );

    const batteries: Record<string, unknown>[] = [];
    let failure: Omit<ReadIssue, "component"> | null = null;
    for (const device of devices) {
      if (device.status === "rejected") failure ??= failedIssue(device.reason);
      else if (device.value !== null) batteries.push(device.value);
    }
    state.present = batteries.length > 0 ? true : failure ? null : false;
    if (failure) {
      // An unreadable device might be a second system battery; never invent a single-battery aggregate.
      if (state.present === null) state.issues.push({ component: "present", ...failure });
      missingFields(state, failure);
    } else if (batteries.length !== 1) {
      missingFields(state, {
        code: "unsupported",
        message:
          batteries.length === 0
            ? "No present system battery was found"
            : "Multiple system batteries are present; aggregate readings are not supported",
      });
    } else {
      readBatteryFields(state, batteries[0]!);
    }
  } catch (error) {
    const issue = failedIssue(error);
    state.issues.push({ component: "present", ...issue });
    missingFields(state, issue);
  }
}

/** UPower and the Acer limiter are independent sources; one failing never hides the other. */
export async function readBattery(context: HardwareContext): Promise<BatteryState> {
  requireLinux(context);
  const state: BatteryState = {
    present: null,
    percentage: null,
    healthPercent: null,
    cycles: null,
    state: null,
    onBattery: null,
    chargeLimit: { enabled: null, limitPercent: 80 },
    issues: [],
  };
  await Promise.all([
    readSystemBattery(context, state),
    (async () => {
      try {
        const properties = await getProperties(context, service);
        if (typeof properties.OnBattery !== "boolean")
          throw new ApiError("IO_ERROR", "UPower returned an invalid OnBattery property");
        state.onBattery = properties.OnBattery;
      } catch (error) {
        state.issues.push({ component: "onBattery", ...failedIssue(error) });
      }
    })(),
    (async () => {
      try {
        state.chargeLimit = await readChargeLimit(context);
        if (state.chargeLimit.enabled === null)
          state.issues.push({
            component: "chargeLimit.enabled",
            code: "unknown",
            message: "The driver did not report the charge limiter state",
          });
      } catch (error) {
        state.issues.push({ component: "chargeLimit.enabled", ...failedIssue(error) });
      }
    })(),
  ]);
  state.issues.sort((a, b) => a.component.localeCompare(b.component));
  return state;
}

export function createBattery(context: HardwareContext) {
  return {
    /** Read the present laptop battery and independent limiter; missing fields are null with issues. */
    get: () => respond(() => readBattery(context)),

    /**
     * Toggle the Acer driver's fixed 80% limiter and verify its boolean readback.
     * Authorization is opt-in. Disabling returns charging policy to firmware; it does not force charging.
     * A failed write can already have taken effect; no automatic retry or rollback is performed.
     */
    setChargeLimit: (input: { enabled: boolean }, options?: HardwareWriteOptions) =>
      setChargeLimit(context, input, options),
  };
}
