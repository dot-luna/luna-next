export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ErrorInfo {
  code: string;
  message: string;
  details?: JsonValue;
}

/** Every API operation returns the same discriminated, JSON-serializable envelope. */
export type ApiResponse<T> = { ok: true; result: T } | { ok: false; error: ErrorInfo };

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly details?: JsonValue) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorInfo(error: unknown): ErrorInfo {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) };
  }
  if (error && typeof error === "object" && "stderr" in error && error.stderr instanceof Uint8Array) {
    return { code: "IO_ERROR", message: new TextDecoder().decode(error.stderr).trim() || "Filesystem command failed" };
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return { code: "IO_ERROR", message: error.message, details: { systemCode: error.code } };
  }
  return { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
}

/** Catch operation failures without printing or changing the caller's exit status. */
export async function respond<T>(operation: () => T | Promise<T>): Promise<ApiResponse<T>> {
  try {
    return { ok: true, result: await operation() };
  } catch (error) {
    return { ok: false, error: errorInfo(error) };
  }
}

/** One undecorated JSON line for a CLI's --json mode or an IPC transport. */
export function serializeResponse<T>(response: ApiResponse<T>): string {
  return JSON.stringify(response) + "\n";
}
