import { z } from "zod";
import { ApiError, respond, type ApiResponse } from "../lib/response.ts";
import {
  errorMessage,
  isMissing,
  optionalText,
  requireLinux,
  type HardwareContext,
} from "./context.ts";
import {
  enabledInputSchema,
  fanTargetsSchema,
  helperRequestSchema,
  validate,
  writeOptionsSchema,
} from "./schema.ts";
import type {
  ChargeLimitState,
  FanState,
  HardwareCapability,
  HardwareWriteOptions,
  KeyboardState,
} from "./types.ts";

export const HELPER_PATH = "/usr/lib/luna/luna-hardware-helper";
const PKEXEC_PATH = "/usr/bin/pkexec";
const MODULE_PATH = "/sys/module/linuwu_sense";
const DRIVER_PATH = "/sys/bus/platform/drivers/acer-wmi";
const DEVICE_PATH = "/sys/devices/platform/acer-wmi";
const NITRO_PATH = `${MODULE_PATH}/drivers/platform:acer-wmi/acer-wmi/nitro_sense`;
const ATTRIBUTES = ["fan_speed", "battery_limiter", "backlight_timeout"] as const;
type AcerAttribute = (typeof ATTRIBUTES)[number];
export type HelperRequest = z.infer<typeof helperRequestSchema>;
export type AcerState = FanState | ChargeLimitState | KeyboardState;

/** Missing prerequisites differ from a missing optional control on a recognized driver. */
export class AcerUnavailableError extends ApiError {
  constructor(
    readonly status: "unavailable" | "unsupported",
    message: string,
  ) {
    super("INVALID_ENVIRONMENT", message);
  }
}

async function resolveNitroDirectory(context: HardwareContext): Promise<string> {
  requireLinux(context);
  const [manufacturer, model] = await Promise.all([
    optionalText(context, "/sys/class/dmi/id/sys_vendor"),
    optionalText(context, "/sys/class/dmi/id/product_name"),
  ]);
  if (manufacturer === null || model === null)
    throw new AcerUnavailableError("unavailable", "Laptop identity is unavailable");
  if (manufacturer !== "Acer" || model !== "Nitro ANV15-51")
    throw new AcerUnavailableError("unsupported", "Acer controls require an Acer Nitro ANV15-51");

  try {
    const [module, driver, device, deviceDriver, directory] = await Promise.all([
      context.realPath(`${DRIVER_PATH}/module`),
      context.realPath(`${MODULE_PATH}/drivers/platform:acer-wmi`),
      context.realPath(`${DRIVER_PATH}/acer-wmi`),
      context.realPath(`${DEVICE_PATH}/driver`),
      context.realPath(NITRO_PATH),
    ]);
    if (
      module !== MODULE_PATH ||
      driver !== DRIVER_PATH ||
      device !== DEVICE_PATH ||
      deviceDriver !== DRIVER_PATH ||
      directory !== `${DEVICE_PATH}/nitro_sense`
    )
      throw new AcerUnavailableError(
        "unavailable",
        "Acer driver/device identity does not match Linuwu Sense",
      );
    if ((await context.metadata(directory)).kind !== "directory")
      throw new AcerUnavailableError(
        "unavailable",
        "Linuwu Nitro control directory is unavailable",
      );
    return directory;
  } catch (error) {
    if (isMissing(error))
      throw new AcerUnavailableError(
        "unavailable",
        "Linuwu Sense is not loaded with its Nitro controls",
      );
    throw error;
  }
}

async function resolveAttribute(
  context: HardwareContext,
  directory: string,
  attribute: AcerAttribute,
): Promise<string> {
  if (!ATTRIBUTES.includes(attribute))
    throw new ApiError("INVALID_ARGUMENT", "Unknown Acer attribute");
  const path = `${directory}/${attribute}`;
  try {
    const [real, metadata] = await Promise.all([context.realPath(path), context.metadata(path)]);
    if (
      real !== path ||
      metadata.kind !== "file" ||
      metadata.uid !== 0 ||
      (metadata.mode & 0o022) !== 0
    )
      throw new AcerUnavailableError("unavailable", `Untrusted Acer control: ${attribute}`);
    return path;
  } catch (error) {
    if (isMissing(error))
      throw new AcerUnavailableError("unsupported", `Acer driver does not expose ${attribute}`);
    throw error;
  }
}

/** Only fixed kernel-owned endpoints are eligible, including when the helper is invoked directly. */
export async function resolveAcerAttribute(
  context: HardwareContext,
  attribute: AcerAttribute,
): Promise<string> {
  return resolveAttribute(context, await resolveNitroDirectory(context), attribute);
}

export function attributeForOperation(operation: HelperRequest["operation"]): AcerAttribute {
  switch (operation) {
    case "fanTargets":
      return "fan_speed";
    case "chargeLimit":
      return "battery_limiter";
    case "keyboardTimeout":
      return "backlight_timeout";
  }
}

/** Readback describes cached requests, not current fan motion or duty. */
export function parseFanState(text: string): FanState {
  const match = /^(0|[1-9][0-9]?|100),(0|[1-9][0-9]?|100)$/u.exec(text.trim());
  if (!match) throw new ApiError("IO_ERROR", "Invalid fan target readback from the Acer driver");
  return { driverReportedTargets: { cpu: Number(match[1]), gpu: Number(match[2]) } };
}

export function parseChargeLimit(text: string): ChargeLimitState {
  const value = text.trim();
  if (value !== "0" && value !== "1")
    throw new ApiError("IO_ERROR", "Invalid battery limiter readback from the Acer driver");
  return { enabled: value === "1", limitPercent: 80 };
}

export function parseKeyboardState(text: string): KeyboardState {
  const value = text.trim();
  if (value !== "0" && value !== "1" && value !== "-1")
    throw new ApiError("IO_ERROR", "Invalid keyboard timeout readback from the Acer driver");
  return { enabled: value === "-1" ? null : value === "1", timeoutSeconds: 30 };
}

export async function readFanState(context: HardwareContext): Promise<FanState> {
  return parseFanState(await context.readText(await resolveAcerAttribute(context, "fan_speed")));
}

/** Throws for a missing control or invalid boolean; battery.get translates this into a partial-read issue. */
export async function readChargeLimit(context: HardwareContext): Promise<ChargeLimitState> {
  return parseChargeLimit(
    await context.readText(await resolveAcerAttribute(context, "battery_limiter")),
  );
}

export async function readKeyboardState(context: HardwareContext): Promise<KeyboardState> {
  return parseKeyboardState(
    await context.readText(await resolveAcerAttribute(context, "backlight_timeout")),
  );
}

async function trustedExecutable(context: HardwareContext, path: string): Promise<boolean> {
  try {
    const parts = path.split("/").filter(Boolean);
    const paths = ["/", ...parts.map((_, index) => `/${parts.slice(0, index + 1).join("/")}`)];
    for (const item of paths) {
      const [resolved, value] = await Promise.all([context.realPath(item), context.metadata(item)]);
      if (resolved !== item || value.uid !== 0 || (value.mode & 0o022) !== 0) return false;
      if (item === path) {
        if (value.kind !== "file" || (value.mode & 0o111) === 0) return false;
      } else if (value.kind !== "directory") return false;
    }
    return true;
  } catch {
    return false;
  }
}

function unavailable(error: unknown): HardwareCapability {
  return {
    status: error instanceof AcerUnavailableError ? error.status : "unavailable",
    reason: errorMessage(error),
  };
}

/** Discovery never elevates; write readiness does not change whether a driver control exists. */
export async function inspectAcer(context: HardwareContext) {
  const [helperAvailable, polkitAvailable] = await Promise.all([
    trustedExecutable(context, HELPER_PATH),
    trustedExecutable(context, PKEXEC_PATH),
  ]);
  let capabilities: HardwareCapability[];
  try {
    const directory = await resolveNitroDirectory(context);
    capabilities = await Promise.all(
      ATTRIBUTES.map(async (attribute): Promise<HardwareCapability> => {
        try {
          await resolveAttribute(context, directory, attribute);
          return { status: "available", reason: null };
        } catch (error) {
          return unavailable(error);
        }
      }),
    );
  } catch (error) {
    capabilities = ATTRIBUTES.map(() => unavailable(error));
  }
  return {
    features: {
      fanControl: capabilities[0]!,
      chargeLimit: capabilities[1]!,
      keyboardTimeout: capabilities[2]!,
    },
    privilegedWrites: { helperAvailable, polkitAvailable },
  };
}

const failureSchema = z.strictObject({
  succes: z.literal(false),
  err: z.enum([
    "INVALID_PATH",
    "INVALID_METADATA",
    "INVALID_ENVIRONMENT",
    "INVALID_ARGUMENT",
    "INPUT_REQUIRED",
    "COMMAND_FAILED",
    "CONFLICT",
    "IO_ERROR",
  ]),
  errMessage: z.string().max(4096),
});
const fanStateSchema = z.strictObject({ driverReportedTargets: fanTargetsSchema });
const chargeLimitStateSchema = z.strictObject({
  enabled: z.boolean(),
  limitPercent: z.literal(80),
});
const keyboardStateSchema = z.strictObject({ enabled: z.boolean(), timeoutSeconds: z.literal(30) });
export const UNCERTAIN_EFFECTS =
  "Hardware effects may be partial or unknown. A fresh read is observational and does not prove rollback.";

/** Client-side escalation accepts only the installed helper's bounded, operation-specific result. */
async function requestWrite<T extends AcerState>(
  context: HardwareContext,
  request: HelperRequest,
  options: HardwareWriteOptions | undefined,
  stateSchema: z.ZodType<T>,
): Promise<T> {
  const settings = validate(writeOptionsSchema, options === undefined ? {} : options);
  await resolveAcerAttribute(context, attributeForOperation(request.operation));
  const [helperAvailable, polkitAvailable] = await Promise.all([
    trustedExecutable(context, HELPER_PATH),
    trustedExecutable(context, PKEXEC_PATH),
  ]);
  if (!helperAvailable || !polkitAvailable)
    throw new ApiError(
      "INVALID_ENVIRONMENT",
      "A trusted installed Luna hardware helper and pkexec are required",
    );
  if (!settings.allowAuthorization)
    throw new ApiError(
      "INPUT_REQUIRED",
      "Set allowAuthorization: true to permit system authorization for Acer writes",
    );
  const remaining = Math.floor(request.deadlineUptimeMs - context.monotonicMs());
  if (remaining <= 0)
    throw new ApiError("COMMAND_FAILED", "Hardware request expired before authorization");

  let result;
  try {
    result = await context.run({
      argv: [PKEXEC_PATH, "--disable-internal-agent", HELPER_PATH, JSON.stringify(request)],
      timeoutMs: remaining,
    });
  } catch (error) {
    throw new ApiError(
      "COMMAND_FAILED",
      `Hardware authorization/write failed: ${errorMessage(error)}. ${UNCERTAIN_EFFECTS}`,
    );
  }
  if (result.code === 126 || result.code === 127) {
    const reason =
      result.code === 126
        ? "Authorization was canceled"
        : "Authorization was denied or the helper could not execute";
    throw new ApiError(
      "COMMAND_FAILED",
      `${reason}: ${result.stderr.slice(0, 1024)}. ${UNCERTAIN_EFFECTS}`,
    );
  }
  if (result.stdout.length > 16_384)
    throw new ApiError(
      "IO_ERROR",
      `Hardware helper response exceeds its limit. ${UNCERTAIN_EFFECTS}`,
    );
  let decoded: unknown;
  try {
    decoded = JSON.parse(result.stdout);
  } catch {
    throw new ApiError(
      result.code === 0 ? "IO_ERROR" : "COMMAND_FAILED",
      `Hardware authorization/write failed (exit ${result.code}): ${result.stderr.slice(0, 1024)}. ${UNCERTAIN_EFFECTS}`,
    );
  }
  const failed = failureSchema.safeParse(decoded);
  if (failed.success)
    throw new ApiError(failed.data.err, `${failed.data.errMessage} ${UNCERTAIN_EFFECTS}`);
  const accepted = z
    .strictObject({ succes: z.literal(true), data: stateSchema })
    .safeParse(decoded);
  if (result.code !== 0 || !accepted.success)
    throw new ApiError(
      "IO_ERROR",
      `Invalid hardware helper response (exit ${result.code}). ${UNCERTAIN_EFFECTS}`,
    );
  const state = accepted.data.data;
  const matches =
    request.operation === "fanTargets"
      ? "driverReportedTargets" in state &&
        state.driverReportedTargets.cpu === request.input.cpu &&
        state.driverReportedTargets.gpu === request.input.gpu
      : "enabled" in state && state.enabled === request.input.enabled;
  if (!matches)
    throw new ApiError(
      "CONFLICT",
      `Hardware helper readback differs from the request. ${UNCERTAIN_EFFECTS}`,
    );
  return state;
}

export function setFanTargets(
  context: HardwareContext,
  input: { cpu: number; gpu: number },
  options?: HardwareWriteOptions,
): Promise<ApiResponse<FanState>> {
  return respond(() =>
    requestWrite(
      context,
      {
        operation: "fanTargets",
        input: validate(fanTargetsSchema, input),
        deadlineUptimeMs: context.monotonicMs() + 120_000,
      },
      options,
      fanStateSchema,
    ),
  );
}

export function setChargeLimit(
  context: HardwareContext,
  input: { enabled: boolean },
  options?: HardwareWriteOptions,
): Promise<ApiResponse<ChargeLimitState>> {
  return respond(() =>
    requestWrite(
      context,
      {
        operation: "chargeLimit",
        input: validate(enabledInputSchema, input),
        deadlineUptimeMs: context.monotonicMs() + 120_000,
      },
      options,
      chargeLimitStateSchema,
    ),
  );
}

export function setKeyboardTimeout(
  context: HardwareContext,
  input: { enabled: boolean },
  options?: HardwareWriteOptions,
): Promise<ApiResponse<KeyboardState>> {
  return respond(() =>
    requestWrite(
      context,
      {
        operation: "keyboardTimeout",
        input: validate(enabledInputSchema, input),
        deadlineUptimeMs: context.monotonicMs() + 120_000,
      },
      options,
      keyboardStateSchema,
    ),
  );
}
