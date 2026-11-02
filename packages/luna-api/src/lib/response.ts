export type ApiErrorCode =
  | "INVALID_PATH"
  | "INVALID_METADATA"
  | "INVALID_ENVIRONMENT"
  | "INVALID_ARGUMENT"
  | "INPUT_REQUIRED"
  | "COMMAND_FAILED"
  | "IO_ERROR";

export type SuccessResponse<T> = { succes: true; data: T };

/** Error codes are machine-readable; errMessage explains the failure to a person. */
export type ErrorResponse = { succes: false; err: ApiErrorCode; errMessage: string };

/** The succes flag determines which fields exist. Callers must supply JSON-compatible data. */
export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

/** Carry an expected API failure to the response boundary without logging or printing. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function success<T>(data: T): SuccessResponse<T> {
  return { succes: true, data };
}

export function failure(err: ApiErrorCode, errMessage: string): ErrorResponse {
  return { succes: false, err, errMessage };
}

/** Preserve expected API error codes; classify other failures as IO_ERROR. */
export async function respond<T>(operation: () => T | Promise<T>): Promise<ApiResponse<T>> {
  try {
    return success(await operation());
  } catch (error) {
    if (error instanceof ApiError) return failure(error.code, error.message);
    return failure("IO_ERROR", error instanceof Error ? error.message : String(error));
  }
}
