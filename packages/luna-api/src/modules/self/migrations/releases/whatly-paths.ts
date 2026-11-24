import { userInfo } from "node:os";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "pathe";
import { metadata } from "@/lib/files.ts";
import { hasControlCharacters, ordinaryParents, overlaps } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";
import type { InstallContext } from "@/modules/self/install/command.ts";

const profileConfig = /^whatly(?:-[a-z0-9_-]{1,32})?\.conf(?:\.lock)?$/u;
const desktopId = "net.shakaran.whatly";

class WhatlyPaths {
  /**
   * Enumerate only Whatly-owned paths, including named profiles and relocated engine storage.
   * Returns the paths and the current text of each settings file, so cleanup can detect edits.
   * Throws when a path contains HOME, the checkout or Luna state, or overlaps Chromium data.
   */
  async collect(context: InstallContext) {
    const { env, home } = context;
    const config = env.XDG_CONFIG_HOME!;
    const data = env.XDG_DATA_HOME!;
    const cache = env.XDG_CACHE_HOME!;
    const state = env.XDG_STATE_HOME!;
    const paths = new Set([
      join(home, ".local/bin/whatly"),
      ...["LUNA_GIT_APP_CLONE_DIR", "LUNA_GIT_APP_BUILD_DIR", "LUNA_GIT_APP_INSTALL_DIR"].map(
        (key) => join(env[key]!, "whatly"),
      ),
      ...[data, cache, state, config].map((root) => join(root, "shakaran/whatly")),
      join(data, "whatly"),
      join(data, "applications", desktopId + ".desktop"),
      join(config, "autostart", desktopId + ".desktop"),
      join(data, "metainfo", desktopId + ".appdata.xml"),
      join(data, "licenses/whatly"),
      join(env.LUNA_STATE_HOME_DIR!, "apps/whatly.jsonc"),
    ]);
    // Qt uses RuntimeLocation, falling back to TempLocation if it is unavailable.
    const temporary = env.TMPDIR || "/tmp";
    const runtime = env.XDG_RUNTIME_DIR || join(temporary, `runtime-${userInfo().username}`);
    for (const directory of new Set([runtime, temporary])) {
      if (!isAbsolute(directory) || resolve(directory) === "/")
        throw new ApiError("INVALID_PATH", "Whatly runtime paths must be absolute and non-root");
      for (const name of await this._names(directory)) {
        if (!/^whatly-unread(?:-[a-z0-9_-]{1,32})?$/u.test(name)) continue;
        const path = join(directory, name);
        const info = await metadata(path);
        if (info && info.uid === process.getuid?.() && (info.isFile() || info.isSymbolicLink()))
          paths.add(path);
      }
    }
    const settings = new Map<string, string>();
    for (const name of await this._names(join(config, "shakaran"))) {
      if (!profileConfig.test(name)) continue;
      const path = join(config, "shakaran", name);
      paths.add(path);
      if (name.endsWith(".lock")) continue;
      const info = await metadata(path);
      if (!info?.isFile())
        throw new ApiError("INVALID_PATH", `Whatly settings must be a regular file: ${path}`);
      const source = await readFile(path, "utf8");
      settings.set(path, source);
      const custom = this._storageDirectory(source);
      if (!custom) continue;
      if (
        [home, config, data, cache, state].includes(custom) ||
        overlaps(custom, context.repository)
      )
        throw new ApiError("INVALID_PATH", "Whatly's custom storage must have its own directory");
      for (const directory of [custom, join(custom, "cache")]) {
        for (const entry of await this._names(directory)) {
          if (/^(?:QtWebEngine|session-snapshots)(?:-[a-zA-Z0-9_-]+)?$/u.test(entry))
            paths.add(join(directory, entry));
        }
      }
    }
    const icons = join(data, "icons/hicolor");
    for (const size of await this._names(icons)) {
      const directory = join(icons, size, "apps");
      if (!(await metadata(join(icons, size)))?.isDirectory()) continue;
      for (const name of await this._names(directory)) {
        if (/^(?:net\.shakaran\.whatly(?:-symbolic)?|whatly)\.(?:png|svg|xpm)$/u.test(name))
          paths.add(join(directory, name));
      }
    }
    const protectedPaths = [
      home,
      context.repository,
      env.LUNA_STATE_HOME_DIR!,
      join(env.CHROME_CONFIG_HOME || config, "chromium"),
      env.CHROME_USER_DATA_DIR,
    ].filter((path): path is string => !!path);
    for (const path of paths) {
      await ordinaryParents(path);
      if (
        protectedPaths.some(
          (protectedPath) => path === protectedPath || protectedPath.startsWith(path + "/"),
        ) ||
        overlaps(path, context.repository) ||
        overlaps(
          path,
          env.CHROME_USER_DATA_DIR || join(env.CHROME_CONFIG_HOME || config, "chromium"),
        )
      )
        throw new ApiError("INVALID_PATH", `Whatly cleanup overlaps protected data: ${path}`);
    }
    return { paths: [...paths], settings };
  }

  /** Entries of a directory reached through ordinary parents; none when it is missing. */
  private async _names(directory: string) {
    await ordinaryParents(join(directory, "entry"));
    return (await metadata(directory)) ? readdir(directory) : [];
  }

  /** Read Qt's scalar storage override; refuse undecodable values before deleting settings. */
  private _storageDirectory(source: string) {
    let section = "General";
    let value = "";
    for (const line of source.split(/\r?\n/u)) {
      const group = /^\s*\[([^\]]+)\]\s*$/u.exec(line);
      if (group) {
        section = group[1]!;
        continue;
      }
      const setting = /^\s*([^=]+?)\s*=(.*)$/u.exec(line);
      if (
        setting &&
        ((section === "storage" && setting[1] === "dataDir") ||
          (section === "General" && setting[1] === "storage\\dataDir"))
      )
        value = setting[2]!.trim();
    }
    if (!value) return null;
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.includes(","))
      throw new ApiError("INVALID_METADATA", "Invalid Whatly storage/dataDir list");
    value = value.replace(/\\(x[0-9a-fA-F]{1,4}|.)/gu, (_, code: string) => {
      if (code.startsWith("x")) return String.fromCharCode(parseInt(code.slice(1), 16));
      if (!/[\\"nrt]/u.test(code))
        throw new ApiError("INVALID_METADATA", "Unsupported Whatly storage path escape");
      return ({ "\\": "\\", '"': '"', n: "\n", r: "\r", t: "\t" } as Record<string, string>)[code]!;
    });
    if (!isAbsolute(value) || resolve(value) === "/" || hasControlCharacters(value))
      throw new ApiError(
        "INVALID_PATH",
        "Whatly storage/dataDir must be an absolute non-root path",
      );
    return resolve(value);
  }
}

export const whatlyPaths = new WhatlyPaths();
