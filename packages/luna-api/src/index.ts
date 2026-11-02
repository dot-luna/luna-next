import { info } from "./info/index.ts";
import { install } from "./self/install/index.ts";
import { update } from "./self/update.ts";
import { theme } from "./theme/index.ts";

export const Luna = { info, self: { install, update }, theme };

export type { InfoOptions, LunaInfo, LunaInfoResponse } from "./info/types.ts";
export type { ApiErrorCode, ApiResponse, ErrorResponse, SuccessResponse } from "./lib/response.ts";
export type {
  GitIdentity,
  InstallOptions,
  InstallResult,
  InstallResponse,
} from "./self/install/types.ts";
export type { UpdateOptions, UpdateResult, UpdateResponse } from "./self/update.ts";
export type {
  ThemeMode,
  ThemeOptions,
  ThemeInstallOptions,
  ThemeEntry,
  ResolvedTheme,
} from "./theme/types.ts";
