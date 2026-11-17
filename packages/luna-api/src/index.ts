import { info } from "@/info/index.ts";
import { install } from "@/self/install/index.ts";
import { update } from "@/self/update.ts";
import { theme } from "@/theme/index.ts";
import { apps } from "@/modules/apps/index.ts";
import { webapp } from "@/modules/webapp/index.ts";
import { notify } from "@/notify/index.ts";
import { menu } from "@/menu/index.ts";
import { defaults } from "@/defaults/index.ts";
import { wallpaper } from "@/wallpaper/index.ts";
import { lock } from "@/lock/index.ts";
import { screensaver } from "@/screensaver/index.ts";
import { screenshot } from "@/screenshot/index.ts";
import { clipboard } from "@/modules/clipboard/index.ts";

import { emoji } from "@/modules/emoji/index.ts";
export type { EmojiEntry } from "@/modules/emoji/schema.ts";

export const Luna = {
  info,
  self: { install, update },
  theme,
  apps,
  webapp,
  menu,
  notify,
  defaults,
  wallpaper,
  screensaver,
  lock,
  screenshot,
  clipboard,
  emoji,
};

export type { ClipboardOptions, ClipboardPasteOptions } from "@/modules/clipboard/context.ts";
export type { ClipboardEntry, ClipboardPreview } from "@/modules/clipboard/schema.ts";

export type {
  ScreenshotMode,
  ScreenshotOptions,
  ScreenshotResult,
  ScreenshotTextOptions,
  ScreenshotTextResult,
} from "@/screenshot/context.ts";

export type { LockOptions, LockState } from "@/lock/context.ts";
export type { LockSettings } from "@/lock/schema.ts";

export type { ScreensaverOptions, ScreensaverState } from "@/screensaver/context.ts";
export type { ScreensaverSettings } from "@/screensaver/schema.ts";

export type {
  WallpaperOptions,
  WallpaperState,
  WallpaperInstallOptions,
  WallpaperEntry,
} from "@/wallpaper/context.ts";
export type { WallpaperSettings } from "@/wallpaper/schema.ts";

export type { DefaultsOptions, DefaultEntry, DefaultsResult } from "@/defaults/types.ts";

export type { MenuOptions, MenuState, StayAwakeState } from "@/menu/context.ts";
export type { StayAwakeAction } from "@/menu/schema.ts";

export type { InfoOptions, LunaInfo, LunaInfoResponse } from "@/info/types.ts";
export type { ApiErrorCode, ApiResponse, ErrorResponse, SuccessResponse } from "@/lib/response.ts";
export type {
  GitIdentity,
  InstallOptions,
  InstallResult,
  InstallResponse,
} from "@/self/install/types.ts";
export type { UpdateOptions, UpdateResult, UpdateResponse } from "@/self/update.ts";
export type {
  ThemeMode,
  ThemeOptions,
  ThemeInstallOptions,
  ThemeEntry,
  ResolvedTheme,
} from "@/theme/types.ts";
export type { AppOptions, AppUninstallOptions } from "@/modules/apps/context.ts";
export type { WebappOptions } from "@/modules/webapp/context.ts";
export type { WebappInstallOptions } from "@/modules/webapp/index.ts";
export type { WebappLaunchOptions } from "@/modules/webapp/launch.ts";
export type { WebappRecord } from "@/modules/webapp/schema.ts";

export type { AppInstallResult, InstallFailure } from "@/install/report.ts";

export type { NotifyOptions, NotifyState } from "@/notify/context.ts";

export type { NotifySettings } from "@/notify/schema.ts";
