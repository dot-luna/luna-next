import { z } from "zod";
import { ApiError } from "../lib/response.ts";

export const powerProfileSchema = z.enum(["power-saver", "balanced", "performance"]);
export const powerInputSchema = z.strictObject({ profile: powerProfileSchema });
export const fanTargetsSchema = z.strictObject({
  cpu: z.number().int().min(0).max(100),
  gpu: z.number().int().min(0).max(100),
});
export const enabledInputSchema = z.strictObject({ enabled: z.boolean() });
export const writeOptionsSchema = z.strictObject({ allowAuthorization: z.boolean().optional() });

const deadlineUptimeMs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const helperRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("fanTargets"), input: fanTargetsSchema, deadlineUptimeMs }),
  z.strictObject({
    operation: z.literal("chargeLimit"),
    input: enabledInputSchema,
    deadlineUptimeMs,
  }),
  z.strictObject({
    operation: z.literal("keyboardTimeout"),
    input: enabledInputSchema,
    deadlineUptimeMs,
  }),
]);

const ticks = z.string().regex(/^(0|[1-9][0-9]{0,29})$/u);
export const cpuSampleSchema = z
  .strictObject({
    bootId: z.uuid(),
    totalTicks: ticks,
    idleTicks: ticks,
  })
  .refine((value) => BigInt(value.idleTicks) <= BigInt(value.totalTicks), {
    message: "Idle ticks cannot exceed total ticks",
  });
export const metricsInputSchema = z.strictObject({
  previousCpu: cpuSampleSchema.nullable().optional(),
});

/** The unprivileged API and installed helper use the same input rules. */
export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError("INVALID_ARGUMENT", parsed.error.message);
  return parsed.data;
}
