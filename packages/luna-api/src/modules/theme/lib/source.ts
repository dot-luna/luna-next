import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "pathe";
import { metadata } from "@/lib/files.ts";
import { hasControlCharacters } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";
import type { ThemeContext, ThemeInstallOptions } from "./context.ts";
import { githubSource, type RemoteThemeFile } from "./github.ts";
import { themePackages } from "./packages.ts";
import { themeRemote } from "./remote.ts";
import { themeSelection } from "./selection.ts";
import { themeStore } from "./store.ts";
import { themeValues } from "./values.ts";

export interface ThemeInfo {
  suggestedName: string;
  needsName: boolean;
  remote: boolean;
  fingerprint: string;
  files: { path: string; size?: number }[];
  wallpapers: string[];
  fonts: { ui: string; mono: string };
  packages: { name: string; source: "pacman" | "aur"; installed: boolean }[];
}
interface Source {
  text: string;
  manifestPath: string;
  stem: string;
  file: boolean;
  remote: boolean;
  revision?: string;
  directory?: string;
  localFile?: string;
  files: RemoteThemeFile[];
}
const generic = /^(theme|config|settings)$/iu;

/** Resolve source metadata once per operation. Preview never downloads assets or installs packages. */
class ThemeSource {
  async preview({
    context,
    source,
  }: {
    context: ThemeContext;
    source: string;
  }): Promise<ThemeInfo> {
    const input = await this._read(source);
    const value = themeValues.resolve({
      source: await this._value({ input, source }),
      name: input.stem,
    });
    const missing = await themePackages.missing({ context, packages: value.packages });
    return {
      suggestedName: this._name(input.stem),
      needsName: input.file && generic.test(input.stem),
      remote: input.remote,
      fingerprint: this._fingerprint(input),
      files: [
        { path: input.manifestPath },
        ...input.files.map(({ path, size }) => ({ path, size })),
      ],
      wallpapers: value.wallpaper.sources,
      fonts: value.fonts,
      packages: (value.packages ?? []).map((item) => ({
        ...item,
        installed: !missing.some((other) => other.name === item.name),
      })),
    };
  }

  /** Stage source files before invoking the existing validated library publisher. */
  async install({
    context,
    source,
    options,
  }: {
    context: ThemeContext;
    source: string;
    options: ThemeInstallOptions;
  }) {
    const input = await this._read(source);
    const original = await this._value({ input, source });
    if (options.fingerprint && options.fingerprint !== this._fingerprint(input))
      throw new ApiError("CONFLICT", "Theme source changed; preview it again before installing");
    if (!options.name && input.file && generic.test(input.stem))
      throw new ApiError("INPUT_REQUIRED", "Choose a name for this theme");
    const name = themeSelection.validName(options.name ?? this._name(input.stem));
    await themeStore.check({ context, name, force: options.force });
    if (input.directory && !input.localFile)
      return themeStore.install({
        context,
        source: input.directory,
        name,
        force: options.force,
        manifestSource: input.text,
      });
    const temporary = await mkdtemp(join(tmpdir(), "luna-theme-import-"));
    try {
      const root = join(temporary, "theme");
      await mkdir(root);
      await Bun.write(join(root, input.manifestPath), input.text);
      for (const file of input.files) {
        const path = join(root, file.path);
        await mkdir(dirname(path), { recursive: true });
        await themeRemote.download({ url: file.url, path });
      }
      if (input.localFile) {
        const sourceRoot = await realpath(dirname(input.localFile));
        for (const item of original.wallpaper?.sources ?? []) {
          if (/^https?:\/\//iu.test(item)) continue;
          const path = await this._relative({ root: sourceRoot, path: item });
          const destination = join(root, item);
          await mkdir(dirname(destination), { recursive: true });
          if ((await metadata(path))?.isDirectory())
            await cp(path, destination, { recursive: true });
          else await copyFile(path, destination);
        }
      }
      return await themeStore.install({ context, source: root, name, force: options.force });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async _read(source: string): Promise<Source> {
    if (!source || hasControlCharacters(source))
      throw new ApiError("INVALID_ARGUMENT", "Specify a theme source");
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(source)) {
      const url = themeRemote.url(source);
      const github = await githubSource(url);
      if (github) return { ...github, remote: true };
      if (!/\.jsonc?$/iu.test(url.pathname))
        throw new ApiError("INVALID_ARGUMENT", "Remote theme files must be JSON or JSONC");
      const text = await themeRemote.text(url.href);
      const value = themeValues.parse(text, source);
      const files: RemoteThemeFile[] = [];
      for (const path of value.wallpaper?.sources ?? []) {
        if (/^https?:\/\//iu.test(path)) continue;
        this._safeRelative(path);
        files.push({
          path,
          url: new URL(path.split("/").map(encodeURIComponent).join("/"), url).href,
        });
      }
      return {
        text,
        stem: decodeURIComponent(basename(url.pathname)).replace(/\.jsonc?$/iu, ""),
        file: true,
        remote: true,
        manifestPath: url.pathname.endsWith(".jsonc") ? "theme.jsonc" : "theme.json",
        files,
      };
    }
    const path = resolve(source);
    const info = await metadata(path);
    if (info?.isDirectory()) {
      const manifest = await themeValues.manifest(path);
      return {
        text: await readFile(manifest, "utf8"),
        manifestPath: basename(manifest),
        stem: basename(path),
        file: false,
        remote: false,
        directory: path,
        files: [],
      };
    }
    if (!info?.isFile() || !/\.jsonc?$/iu.test(path))
      throw new ApiError("INVALID_PATH", "Choose a JSON/JSONC file or theme folder");
    return {
      text: await readFile(path, "utf8"),
      manifestPath: path.endsWith(".jsonc") ? "theme.jsonc" : "theme.json",
      stem: basename(path).replace(/\.jsonc?$/iu, ""),
      file: true,
      remote: false,
      localFile: path,
      files: [],
    };
  }

  private _name(stem: string) {
    return (
      stem
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/gu, "-")
        .replace(/^-+|-+$/gu, "") || "theme"
    );
  }
  private async _value({ input, source }: { input: Source; source: string }) {
    const value = themeValues.parse(input.text, source);
    for (const path of value.wallpaper?.sources ?? []) {
      if (/^https?:\/\//iu.test(path)) {
        themeRemote.url(path);
        continue;
      }
      this._safeRelative(path);
      const root = input.directory ?? (input.localFile ? dirname(input.localFile) : undefined);
      if (root) await this._relative({ root: await realpath(root), path });
      else if (!input.files.some((file) => file.path === path || file.path.startsWith(path + "/")))
        throw new ApiError("INVALID_PATH", `Theme wallpaper is missing from its folder: ${path}`);
    }
    return value;
  }
  private _fingerprint(input: Source) {
    return createHash("sha256")
      .update(JSON.stringify([input.text, input.revision, input.files]))
      .digest("hex");
  }
  private _safeRelative(path: string) {
    if (
      isAbsolute(path) ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new ApiError("INVALID_PATH", "Theme assets must stay inside their folder");
  }
  private async _relative({ root, path }: { root: string; path: string }) {
    this._safeRelative(path);
    const actual = await realpath(join(root, path));
    if (!actual.startsWith(root + "/"))
      throw new ApiError("INVALID_PATH", "Theme wallpaper escapes its folder");
    return actual;
  }
}
export const themeSource = new ThemeSource();
