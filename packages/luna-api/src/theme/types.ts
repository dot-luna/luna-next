export type ThemeMode = "dark" | "light";

export interface ThemeOptions {
  /** Replaces Bun.env for path selection and child commands. */
  env?: Record<string, string>;
  configFile?: string;
  libraryDir?: string;
  wallpaperDir?: string;
}

export interface ThemeInstallOptions extends ThemeOptions {
  name?: string;
  force?: boolean;
}

export interface ThemeEntry {
  name: string;
  current: boolean;
}

export interface ResolvedTheme {
  name: string;
  colors: Record<string, string> & { mode: ThemeMode };
  fonts: { ui: string; mono: string };
  wallpaper: { sources: string[] };
  appearance: {
    gaps: { inner: number; outer: number };
    border_width: number;
    rounding: number;
    opacity: { active: number; inactive: number; fullscreen: number };
    blur: { enabled: boolean; size: number; passes: number };
    shadow: { enabled: boolean; range: number; falloff: number };
  };
}
