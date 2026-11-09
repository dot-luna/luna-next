import { ApiError, respond } from "../lib/response.ts";
import { errorMessage, requireLinux, type HardwareContext } from "./context.ts";
import { callBus, getProperties } from "./dbus.ts";
import { powerInputSchema, powerProfileSchema, validate } from "./schema.ts";
import type { PowerProfile, PowerState } from "./types.ts";

const service = {
  destination: "org.freedesktop.UPower.PowerProfiles",
  path: "/org/freedesktop/UPower/PowerProfiles",
  interface: "org.freedesktop.UPower.PowerProfiles",
};

function record(value: unknown, property: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ApiError("IO_ERROR", `Power service returned invalid ${property}`);
  return value as Record<string, unknown>;
}

function profile(value: unknown): PowerProfile {
  const parsed = powerProfileSchema.safeParse(value);
  if (!parsed.success)
    throw new ApiError("IO_ERROR", "Power service returned an unrecognized profile");
  return parsed.data;
}

function text(value: unknown, property: string): string {
  if (typeof value !== "string")
    throw new ApiError("IO_ERROR", `Power service returned invalid ${property}`);
  return value;
}

function driver(value: unknown, property: string): string | null {
  if (value === undefined) return null;
  return text(value, property) || null;
}

/** Read the daemon's current selection and advertised support without assuming a firmware backend. */
export async function readPower(context: HardwareContext): Promise<PowerState> {
  requireLinux(context);
  const properties = await getProperties(context, service);
  const active = profile(properties.ActiveProfile);
  if (!Array.isArray(properties.Profiles) || !Array.isArray(properties.ActiveProfileHolds))
    throw new ApiError("IO_ERROR", "Power service returned invalid profiles or profile holds");

  const profiles = properties.Profiles.map((value) => {
    const entry = record(value, "Profiles");
    return {
      profile: profile(entry.Profile),
      cpu: driver(entry.CpuDriver, "CpuDriver"),
      platform: driver(entry.PlatformDriver, "PlatformDriver"),
    };
  });
  const available = profiles.map((entry) => entry.profile);
  const selected = profiles.find((entry) => entry.profile === active);
  if (!selected || new Set(available).size !== available.length)
    throw new ApiError("IO_ERROR", "Power service returned inconsistent profile availability");

  return {
    active,
    available,
    drivers: {
      cpu: selected.cpu,
      platform: selected.platform === "placeholder" ? null : selected.platform,
    },
    performanceDegraded: text(properties.PerformanceDegraded, "PerformanceDegraded") || null,
    holds: properties.ActiveProfileHolds.map((value) => {
      const hold = record(value, "ActiveProfileHolds");
      return {
        profile: profile(hold.Profile),
        applicationId: text(hold.ApplicationId, "ApplicationId"),
        reason: text(hold.Reason, "Reason"),
      };
    }),
  };
}

export function createPower(context: HardwareContext) {
  return {
    /** Read fresh standard profiles, degradation, holds, and the active backend names. */
    get: () => respond(() => readPower(context)),

    /**
     * Select a currently offered standard profile through PPD without interactive authorization.
     * Success confirms the observed daemon selection, not a thermal or clock-speed result.
     * Discard previous fan observations after any attempted mutation, including failures:
     * firmware can reset fan targets before rejecting a profile. No old targets are restored.
     */
    set: (input: { profile: PowerProfile }) =>
      respond(async () => {
        const requested = validate(powerInputSchema, input);
        const before = await readPower(context);
        if (!before.available.includes(requested.profile))
          throw new ApiError(
            "INVALID_ARGUMENT",
            `Power profile ${requested.profile} is not offered`,
          );

        try {
          await callBus(context, {
            ...service,
            interface: "org.freedesktop.DBus.Properties",
            method: "Set",
            signature: "ssv",
            args: [service.interface, "ActiveProfile", "s", requested.profile],
            timeoutMs: 10_000,
          });
          const after = await readPower(context);
          if (after.active !== requested.profile)
            throw new ApiError("CONFLICT", "Power profile changed before verification completed");
          return after;
        } catch (error) {
          throw new ApiError(
            error instanceof ApiError ? error.code : "IO_ERROR",
            `${errorMessage(error)}. Power or fan state may have changed; read both again. No restoration was attempted.`,
          );
        }
      }),
  };
}
