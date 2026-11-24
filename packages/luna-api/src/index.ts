import { info } from "./modules/info/index.ts";
import { self } from "./modules/self/index.ts";
import { theme } from "./modules/theme/index.ts";
import { apps } from "./modules/apps/index.ts";
import { webapp } from "./modules/webapp/index.ts";
import { notify } from "./modules/notify/index.ts";
import { menu } from "./modules/menu/index.ts";
import { bar } from "./modules/bar/index.ts";
import { defaults } from "./modules/defaults/index.ts";
import { wallpaper } from "./modules/wallpaper/index.ts";
import { lock } from "./modules/lock/index.ts";
import { screensaver } from "./modules/screensaver/index.ts";
import { screenshot } from "./modules/screenshot/index.ts";
import { clipboard } from "./modules/clipboard/index.ts";

import { emoji } from "./modules/emoji/index.ts";
export type { EmojiEntry } from "./modules/emoji/schema.ts";

export type { BarOptions, BarState } from "./modules/bar/context.ts";

export const Luna = {
  bar,
  info,
  self,
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

export type { ClipboardOptions, ClipboardPasteOptions } from "./modules/clipboard/context.ts";
export type { ClipboardEntry, ClipboardPreview } from "./modules/clipboard/schema.ts";

export type {
  ScreenshotMode,
  ScreenshotOptions,
  ScreenshotResult,
  ScreenshotTextOptions,
  ScreenshotTextResult,
} from "./modules/screenshot/context.ts";

export type { LockOptions, LockState } from "./modules/lock/context.ts";
export type { LockSettings } from "./modules/lock/schema.ts";

export type { ScreensaverOptions, ScreensaverState } from "./modules/screensaver/context.ts";
export type { ScreensaverSettings } from "./modules/screensaver/schema.ts";

export type {
  WallpaperOptions,
  WallpaperState,
  WallpaperInstallOptions,
  WallpaperEntry,
} from "./modules/wallpaper/context.ts";
export type { WallpaperSettings } from "./modules/wallpaper/schema.ts";

export type { DefaultsOptions, DefaultEntry, DefaultsResult } from "./modules/defaults/types.ts";

export type { MenuOptions, MenuState, StayAwakeState } from "./modules/menu/context.ts";
export type { StayAwakeAction } from "./modules/menu/schema.ts";

export type { InfoOptions, LunaInfo, LunaInfoResponse } from "./modules/info/index.ts";
export type { ApiErrorCode, ApiResponse, ErrorResponse, SuccessResponse } from "./lib/response.ts";
export type { GitIdentity, InstallOptions, UpdateOptions } from "./modules/self/context.ts";
export type {
  InstallResult,
  InstallResponse,
  UpdateResult,
  UpdateResponse,
} from "./modules/self/install/report.ts";
export type { ThemeOptions, ThemeInstallOptions } from "./modules/theme/context.ts";
export type { ThemeMode, ResolvedTheme } from "./modules/theme/schema.ts";
export type { ThemeEntry } from "./modules/theme/store.ts";
export type { AppOptions, AppUninstallOptions } from "./modules/apps/context.ts";
export type { WebappOptions } from "./modules/webapp/context.ts";
export type { WebappInstallOptions } from "./modules/webapp/context.ts";
export type { WebappLaunchOptions } from "./modules/webapp/context.ts";
export type { WebappRecord } from "./modules/webapp/schema.ts";

export type { AppInstallResult, InstallFailure } from "./modules/self/install/report.ts";

export type { NotifyOptions, NotifyState } from "./modules/notify/context.ts";

export type { NotifySettings } from "./modules/notify/schema.ts";
