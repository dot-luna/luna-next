import { ApiError } from "../lib/response.ts";
import type { HardwareContext } from "./context.ts";

interface BusEndpoint {
  destination: string;
  path: string;
  interface: string;
}

interface BusCall extends BusEndpoint {
  method: string;
  signature?: string;
  args?: string[];
  timeoutMs?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** busctl preserves variants as {type,data}; consumers work with decoded property values. */
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (!record(value)) return value;
  if (typeof value.type === "string" && Object.hasOwn(value, "data")) return decode(value.data);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decode(child)]));
}

/** Use Properties.Set via `call`: busctl's set-property shortcut does not honor this authorization flag. */
export async function callBus(context: HardwareContext, call: BusCall): Promise<unknown> {
  const result = await context.run({
    argv: [
      "/usr/bin/busctl",
      "--system",
      "--json=short",
      "--no-pager",
      "--allow-interactive-authorization=no",
      `--timeout=${(call.timeoutMs ?? 5000) / 1000}s`,
      "call",
      call.destination,
      call.path,
      call.interface,
      call.method,
      ...(call.signature ? [call.signature, ...(call.args ?? [])] : []),
    ],
    timeoutMs: call.timeoutMs ?? 5000,
  });
  if (result.code !== 0) {
    const message = result.stderr || result.stdout || `busctl exited with status ${result.code}`;
    const missing =
      /ServiceUnknown|NameHasNoOwner|not provided by any \.service|Failed to connect to bus|No such file or directory/iu.test(
        message,
      );
    throw new ApiError(missing ? "INVALID_ENVIRONMENT" : "COMMAND_FAILED", message);
  }
  // Void methods (including Properties.Set) may produce no stdout.
  if (!result.stdout.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new ApiError("IO_ERROR", "busctl returned invalid JSON");
  }
  if (!record(value) || typeof value.type !== "string" || !Array.isArray(value.data))
    throw new ApiError("IO_ERROR", "busctl returned an invalid method response");
  return decode(value.data);
}

export async function getProperties(
  context: HardwareContext,
  endpoint: BusEndpoint,
): Promise<Record<string, unknown>> {
  const values = await callBus(context, {
    ...endpoint,
    interface: "org.freedesktop.DBus.Properties",
    method: "GetAll",
    signature: "s",
    args: [endpoint.interface],
  });
  if (!Array.isArray(values) || values.length !== 1 || !record(values[0]))
    throw new ApiError("IO_ERROR", `Invalid properties for ${endpoint.interface}`);
  return values[0];
}
