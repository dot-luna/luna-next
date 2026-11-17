import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { AppFixture } from "./fixtures/app-fixture.ts";
import { appsIndexSchema } from "../src/apps/schema.ts";
import { appContext } from "../src/apps/context.ts";
import * as processes from "../src/apps/processes.ts";
import { webappIcon } from "../src/modules/webapp/icon.ts";
import { replaceWhatly } from "../src/self/migrations/releases/whatsapp.ts";
import { whatlyPaths } from "../src/self/migrations/releases/whatly-paths.ts";
import { Luna } from "../src/index.ts";

let f: AppFixture;
let close: ReturnType<typeof spyOn<typeof processes, "closeApp">>;
let icon: ReturnType<typeof spyOn<typeof webappIcon, "downloadBest">>;
beforeEach(() => {
  f = new AppFixture();
  f.browser();
  // Tests must never contact WhatsApp or close processes in the real desktop session.
  close = spyOn(processes, "closeApp").mockResolvedValue();
  icon = spyOn(webappIcon, "downloadBest").mockResolvedValue(undefined);
});
afterEach(() => {
  close.mockRestore();
  icon.mockRestore();
  f.dispose();
});

const run = () => replaceWhatly({ env: f.env });
test("migration installs WhatsApp and removes all owned Whatly files while retaining shared data", async () => {
  const context = await appContext({ env: f.env });
  const files = [
    ".local/bin/whatly",
    ".local/share/luna/git/clone/whatly/source.cpp",
    ".cache/luna/git/build/whatly/.luna-build.json",
    ".local/share/luna/apps/git/whatly/bin/whatly",
    ".config/shakaran/whatly.conf",
    ".config/shakaran/whatly-work.conf",
    ".config/shakaran/whatly-work.conf.lock",
    ".local/share/shakaran/whatly/QtWebEngine/Cookies",
    ".local/share/shakaran/whatly/QtWebEngine-work/IndexedDB/data",
    ".local/share/shakaran/whatly/session-snapshots/default/current/data",
    ".cache/shakaran/whatly/QtWebEngine/cache",
    ".local/state/shakaran/whatly/log",
    ".local/share/whatly/qtwebengine_dictionaries/en_US.bdic",
    ".local/share/applications/net.shakaran.whatly.desktop",
    ".config/autostart/net.shakaran.whatly.desktop",
    ".local/share/metainfo/net.shakaran.whatly.appdata.xml",
    ".local/share/licenses/whatly/LICENSE",
    ".local/share/icons/hicolor/128x128/apps/net.shakaran.whatly.png",
    ".local/share/icons/hicolor/scalable/apps/net.shakaran.whatly.svg",
    ".local/share/icons/hicolor/symbolic/apps/net.shakaran.whatly-symbolic.svg",
    ".local/state/luna/apps/whatly.jsonc",
  ];
  for (const path of files) f.write(f.home, path, "owned");
  const kept = [
    ".config/shakaran/other.conf",
    ".local/share/shakaran/other/session",
    ".cache/shakaran/other/cache",
    ".local/share/applications/other.desktop",
    ".local/share/icons/hicolor/128x128/apps/other.png",
    ".local/share/luna/apps/git/other/bin",
    ".local/state/luna/apps/other.jsonc",
  ];
  for (const path of kept) f.write(f.home, path, "keep");
  const mime =
    "# personal associations\n[Default Applications]\nx-scheme-handler/whatsapp=net.shakaran.whatly.desktop;other.desktop;\ntext/plain=editor.desktop;\n[Added Associations]\nx-scheme-handler/whatsapp=net.shakaran.whatly.desktop;\n";
  f.write(f.home, ".config/mimeapps.list", mime);
  f.write(f.home, ".config/hyprland-mimeapps.list", mime);
  f.write(f.home, ".local/share/applications/mimeapps.list", mime);
  const installed = await run();
  expect(installed.name).toBe("WhatsApp");
  expect(installed.url).toBe("https://web.whatsapp.com/");
  expect(readFileSync(installed.desktopFile, "utf8")).toContain('"webapp" "launch" "WhatsApp"');
  expect(close).toHaveBeenCalledTimes(1);
  expect(close.mock.calls[0]![1].manifest.processes).toEqual(["whatly"]);
  for (const path of files) expect(existsSync(join(f.home, path)), path).toBe(false);
  for (const path of kept) expect(readFileSync(join(f.home, path), "utf8"), path).toBe("keep");
  expect(readFileSync(join(f.home, ".config/chromium/Luna/Preferences"), "utf8")).toBe("{}");
  const cleaned = readFileSync(join(f.home, ".config/mimeapps.list"), "utf8");
  expect(cleaned).toContain("x-scheme-handler/whatsapp=other.desktop;");
  expect(cleaned).toContain("text/plain=editor.desktop;");
  expect(cleaned).not.toContain("whatly");
  expect(await whatlyPaths(context)).toMatchObject({ settings: new Map() });
  await run();
  expect(await Luna.webapp.list({ env: f.env })).toMatchObject({
    succes: true,
    data: [{ name: "WhatsApp" }],
  });
});

test("custom Luna roots and relocated Whatly session storage are cleaned without deleting their containers", async () => {
  f.env.LUNA_GIT_APP_CLONE_DIR = join(f.root, "clone");
  f.env.LUNA_GIT_APP_BUILD_DIR = join(f.root, "build");
  f.env.LUNA_GIT_APP_INSTALL_DIR = join(f.root, "installed");
  const custom = join(f.root, "relocated, storage");
  f.write(f.home, ".config/shakaran/whatly-work.conf", `[storage]\ndataDir="${custom}"\n`);
  for (const path of [
    "QtWebEngine-work/Cookies",
    "QtWebEngine-work-account/IndexedDB/data",
    "cache/QtWebEngine-work/cache",
    "session-snapshots-work/default/current/data",
  ])
    f.write(custom, path, "private");
  f.write(custom, "unrelated", "keep");
  for (const root of ["clone", "build", "installed"]) {
    f.write(f.root, `${root}/whatly/file`, "owned");
    f.write(f.root, `${root}/other/file`, "keep");
  }
  await run();
  expect(existsSync(join(custom, "QtWebEngine-work"))).toBe(false);
  expect(existsSync(join(custom, "QtWebEngine-work-account"))).toBe(false);
  expect(existsSync(join(custom, "cache/QtWebEngine-work"))).toBe(false);
  expect(existsSync(join(custom, "session-snapshots-work"))).toBe(false);
  expect(readFileSync(join(custom, "unrelated"), "utf8")).toBe("keep");
  for (const root of ["clone", "build", "installed"]) {
    expect(existsSync(join(f.root, root, "whatly"))).toBe(false);
    expect(readFileSync(join(f.root, root, "other/file"), "utf8")).toBe("keep");
  }
});

test("failed webapp installation leaves Whatly and its sessions intact", async () => {
  f.write(f.home, ".local/share/shakaran/whatly/QtWebEngine/Cookies", "private");
  rmSync(join(f.home, ".config/chromium/Luna/Preferences"));
  await expect(run()).rejects.toThrow();
  expect(
    readFileSync(join(f.home, ".local/share/shakaran/whatly/QtWebEngine/Cookies"), "utf8"),
  ).toBe("private");
  expect(close).not.toHaveBeenCalled();
});

test("linked parents and shared storage overrides fail before installation or deletion", async () => {
  f.write(f.root, "outside/whatly/session", "keep");
  symlinkSync(join(f.root, "outside"), join(f.home, ".config/shakaran"));
  await expect(run()).rejects.toThrow("ordinary directory");
  expect(readFileSync(join(f.root, "outside/whatly/session"), "utf8")).toBe("keep");
  expect(icon).not.toHaveBeenCalled();
  rmSync(join(f.home, ".config/shakaran"));
  f.write(f.home, ".config/shakaran/whatly.conf", `[storage]\ndataDir=${f.home}\n`);
  await expect(run()).rejects.toThrow("own directory");
  expect(icon).not.toHaveBeenCalled();
});

test("owned leaf links are removed without following them", async () => {
  f.write(f.root, "outside/session", "keep");
  mkdirSync(join(f.home, ".local/share/shakaran"), { recursive: true });
  symlinkSync(join(f.root, "outside"), join(f.home, ".local/share/shakaran/whatly"));
  await run();
  expect(existsSync(join(f.home, ".local/share/shakaran/whatly"))).toBe(false);
  expect(readFileSync(join(f.root, "outside/session"), "utf8")).toBe("keep");
});

test("release catalog installs WhatsApp and contains no Whatly recipe", () => {
  const repository = resolve(import.meta.dir, "../../..");
  const catalog = appsIndexSchema.parse(
    Bun.JSONC.parse(readFileSync(join(repository, "apps/apps.jsonc"), "utf8")),
  );
  expect(catalog.packages).not.toContain("whatly/app.jsonc");
  expect(existsSync(join(repository, "apps/whatly"))).toBe(false);
  const webapps = Bun.JSONC.parse(
    readFileSync(join(repository, "installs/packages.webapp.jsonc"), "utf8"),
  );
  expect(webapps).toContainEqual({ name: "WhatsApp", url: "https://web.whatsapp.com/" });
});
