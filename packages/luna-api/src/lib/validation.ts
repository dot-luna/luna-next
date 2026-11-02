import { z } from "zod";
import { ApiError } from "./response.ts";

export function validate<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError("INVALID_METADATA", `${label}: ${result.error.message}`);
  return result.data;
}
