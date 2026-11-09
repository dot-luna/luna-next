/**
 * One-shot privileged boundary for three Linuwu attributes. This module does not elevate itself.
 * The installed executable supplies root identity and the only real sysfs writer; tests inject
 * isolated I/O. No request may select a file, executable, shell command, or environment value.
 */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { ApiError, respond, type ApiResponse } from "../lib/response.ts";
import {
  attributeForOperation,
  parseChargeLimit,
  parseFanState,
  parseKeyboardState,
  resolveAcerAttribute,
  UNCERTAIN_EFFECTS,
  type AcerState,
} from "./acer.ts";
import { errorMessage, type HardwareContext } from "./context.ts";
import { helperRequestSchema, validate } from "./schema.ts";

interface AttributeWrite {
  path: string;
  value: string;
  /** Called after opening the descriptor, immediately before the single write dispatch. */
  beforeWrite(): void;
}

export interface HelperContext {
  hardware: HardwareContext;
  effectiveUid: number | undefined;
  writeAttribute(request: AttributeWrite): Promise<void>;
}

/**
 * Never truncate or create sysfs files and never retry a short write. Even a rejected write can
 * have partial firmware effects. O_NOFOLLOW rejects replacement of the final path by a symlink.
 */
export async function writeSysfsAttribute(request: AttributeWrite): Promise<void> {
  const file = await open(request.path, constants.O_WRONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0)
      throw new ApiError("INVALID_ENVIRONMENT", "Acer sysfs descriptor is not trusted");
    request.beforeWrite();
    const result = await file.write(request.value, 0, "utf8");
    if (result.bytesWritten !== Buffer.byteLength(request.value))
      throw new ApiError("COMMAND_FAILED", "Acer driver accepted only part of a write");
  } finally {
    await file.close();
  }
}

/**
 * Validate again after elevation, resolve the device again, write once, and verify readback.
 * A host-uptime deadline survives pkexec authorization; the helper also limits its own work to
 * ten seconds. A timed-out kernel operation may finish later, so there is no rollback guarantee.
 */
export async function runHelperRequest(
  raw: unknown,
  context: HelperContext,
): Promise<ApiResponse<AcerState>> {
  const started = context.hardware.monotonicMs();
  let stopped = false;
  let dispatched = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return respond(async () => {
    if (context.effectiveUid !== 0)
      throw new ApiError(
        "INVALID_ENVIRONMENT",
        "The installed hardware helper requires root authorization",
      );
    const request = validate(helperRequestSchema, raw);
    if (request.deadlineUptimeMs > started + 120_000)
      throw new ApiError(
        "INVALID_ARGUMENT",
        "Hardware request deadline exceeds the permitted lifetime",
      );
    const deadline = Math.min(started + 10_000, request.deadlineUptimeMs);
    const assertActive = () => {
      if (stopped || context.hardware.monotonicMs() >= deadline)
        throw new ApiError(
          "COMMAND_FAILED",
          `Hardware helper deadline expired. ${dispatched ? UNCERTAIN_EFFECTS : "No write was dispatched."}`,
        );
    };
    assertActive();

    const operation = async (): Promise<AcerState> => {
      const path = await resolveAcerAttribute(
        context.hardware,
        attributeForOperation(request.operation),
      );
      assertActive();
      const value =
        request.operation === "fanTargets"
          ? `${request.input.cpu},${request.input.gpu}\n`
          : `${request.input.enabled ? 1 : 0}\n`;
      try {
        await context.writeAttribute({
          path,
          value,
          beforeWrite() {
            assertActive();
            dispatched = true;
          },
        });
      } catch (error) {
        throw new ApiError(
          "COMMAND_FAILED",
          `Acer write failed: ${errorMessage(error)}. ${dispatched ? UNCERTAIN_EFFECTS : "No write was dispatched."}`,
        );
      }
      assertActive();
      try {
        const text = await context.hardware.readText(path);
        assertActive();
        switch (request.operation) {
          case "fanTargets": {
            const state = parseFanState(text);
            if (
              state.driverReportedTargets.cpu !== request.input.cpu ||
              state.driverReportedTargets.gpu !== request.input.gpu
            )
              throw new ApiError("CONFLICT", "Fan target readback differs from the request");
            return state;
          }
          case "chargeLimit": {
            const state = parseChargeLimit(text);
            if (state.enabled !== request.input.enabled)
              throw new ApiError("CONFLICT", "Battery limiter readback differs from the request");
            return state;
          }
          case "keyboardTimeout": {
            const state = parseKeyboardState(text);
            if (state.enabled === null)
              throw new ApiError("IO_ERROR", "Keyboard timeout state is unknown after the write");
            if (state.enabled !== request.input.enabled)
              throw new ApiError("CONFLICT", "Keyboard timeout readback differs from the request");
            return state;
          }
        }
      } catch (error) {
        throw new ApiError(
          error instanceof ApiError ? error.code : "IO_ERROR",
          `${errorMessage(error)}. ${UNCERTAIN_EFFECTS}`,
        );
      }
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          stopped = true;
          reject(
            new ApiError(
              "COMMAND_FAILED",
              `Hardware helper deadline expired. ${dispatched ? UNCERTAIN_EFFECTS : "No write was dispatched."}`,
            ),
          );
        },
        Math.max(0, deadline - context.hardware.monotonicMs()),
      );
    });
    try {
      return await Promise.race([operation(), timeout]);
    } finally {
      stopped = true;
      clearTimeout(timer);
    }
  });
}
