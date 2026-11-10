import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { appContext } from "../../../packages/luna-api/src/apps/context.ts";
import { readCatalog } from "../../../packages/luna-api/src/apps/catalog.ts";

const repository = resolve(import.meta.dir, "../../..");
const hooks = join(repository, "apps/whatly/scripts");
const revision = "a".repeat(40);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "luna-whatly % $& $$ $' $` = "));
  const home = join(root, "home");
  const build = join(root, "build/whatly");
  const clone = join(root, "clone/whatly");
  const data = join(root, "desktop data");
  const install = join(root, "native install");
  const commands = join(root, "commands.jsonl");
  const write = (file: string, text: string, mode = 0o644) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { mode });
  };
  mkdirSync(clone, { recursive: true });
  write(join(build, ".luna-build.json"), JSON.stringify({ app: "whatly", revision }));
  write(
    join(root, "bin/git"),
    `#!${process.execPath}
import {appendFileSync, mkdirSync} from 'node:fs';
const args=Bun.argv.slice(2);
appendFileSync(Bun.env.TEST_COMMANDS!,JSON.stringify(args)+'\\n');
if(args.includes('rev-parse')) console.log('${revision}');
else if(args.includes('ls-tree')) console.log('160000 commit ${"b".repeat(40)}\\tsrc/libnotify-qt');
else if(args.includes('config')) console.log('https://example.invalid/notify.git');
else if(args[0]==='clone') mkdirSync(args.at(-1)!,{recursive:true});
else if(!args.includes('checkout')) process.exit(9);
`,
    0o755,
  );
  write(
    join(build, "main.c"),
    `#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
  FILE *out=fopen(getenv("TEST_LAUNCH_LOG"),"w");
  if (!out) return 1;
  fprintf(out,"%s|%s\\n",getenv("APPIMAGE")?getenv("APPIMAGE"):"",getenv("APPDIR")?getenv("APPDIR"):"");
  for(int i=1;i<argc;i++) fprintf(out,"%s\\n",argv[i]);
  fclose(out);
  return 0;
}
`,
  );
  write(
    join(build, "desktop"),
    "[Desktop Entry]\nType=Application\nName=Whatly\nExec=whatly %u\nIcon=whatly\nMimeType=x-scheme-handler/whatsapp;\nActions=Chat;\n\n[Desktop Action Chat]\nName=New Chat\nExec=whatly -n\n",
  );
  for (const name of ["metadata", "LICENSE", "icon.svg"]) write(join(build, name), name);
  // Match upstream's absolute install destinations; --prefix alone would leak outside staging.
  write(
    join(build, "CMakeLists.txt"),
    `cmake_minimum_required(VERSION 3.24)
project(whatly C)
if(DEFINED ENV{TEST_BUILD_FAIL})
  message(FATAL_ERROR "requested fixture failure")
endif()
add_executable(whatly main.c)
install(TARGETS whatly DESTINATION \${CMAKE_INSTALL_PREFIX}/bin)
install(FILES desktop DESTINATION \${CMAKE_INSTALL_PREFIX}/share/applications RENAME net.shakaran.whatly.desktop)
install(FILES metadata DESTINATION \${CMAKE_INSTALL_PREFIX}/share/metainfo RENAME net.shakaran.whatly.appdata.xml)
install(FILES LICENSE DESTINATION \${CMAKE_INSTALL_PREFIX}/share/licenses/whatly)
install(FILES icon.svg DESTINATION \${CMAKE_INSTALL_PREFIX}/share/icons/hicolor/scalable/apps RENAME whatly.svg)
`,
  );
  const env = {
    HOME: home,
    PATH: join(root, "bin") + ":" + Bun.env.PATH,
    LUNA_GIT_APP_CLONE_DIR: dirname(clone),
    LUNA_GIT_APP_BUILD_DIR: dirname(build),
    LUNA_GIT_APP_INSTALL_DIR: install,
    XDG_DATA_HOME: data,
    TEST_COMMANDS: commands,
    TEST_LAUNCH_LOG: join(root, "launch.log"),
  };
  const run = (script: string, extra: Record<string, string> = {}) =>
    Bun.spawnSync([process.execPath, join(hooks, script + ".ts")], {
      env: { ...env, ...extra },
      stdout: "pipe",
      stderr: "pipe",
    });
  return {
    root,
    home,
    build,
    clone,
    data,
    install,
    env,
    run,
    write,
    commands,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("Whatly stages a real CMake build, installs custom paths and preserves profiles", async () => {
  const f = fixture();
  try {
    const settings = join(f.home, ".config/shakaran/whatly.conf");
    const session = join(f.data, "shakaran/whatly/session");
    f.write(settings, "personal settings");
    f.write(session, "personal session");
    const built = f.run("build");
    expect(built.exitCode, built.stderr.toString() + built.stdout.toString()).toBe(0);
    const installed = f.run("install");
    expect(installed.exitCode, installed.stderr.toString()).toBe(0);
    const prefix = join(f.install, "whatly");
    expect(existsSync(join(prefix, "bin/whatly"))).toBe(true);
    expect(readFileSync(join(f.data, "licenses/whatly/LICENSE"), "utf8")).toBe("LICENSE");
    expect(readFileSync(settings, "utf8")).toBe("personal settings");
    expect(readFileSync(session, "utf8")).toBe("personal session");
    const args = ["whatsapp://send?text=hello", "--flag", "quote ' $ %"];
    const launcher = join(f.home, ".local/bin/whatly");
    const launched = Bun.spawnSync([launcher, ...args], {
      env: { ...f.env, APPIMAGE: "stale", APPDIR: "stale" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(launched.exitCode, launched.stderr.toString()).toBe(0);
    expect(readFileSync(f.env.TEST_LAUNCH_LOG, "utf8")).toBe("|\n" + args.join("\n") + "\n");
    const desktop = join(f.data, "applications/net.shakaran.whatly.desktop");
    const text = readFileSync(desktop, "utf8");
    expect(text).toContain("Name=Whatly\n");
    expect(text).toContain("Icon=whatly\n");
    expect(text).not.toContain("Exec=whatly");
    expect(readFileSync(join(f.data, "applications/mimeinfo.cache"), "utf8")).toContain(
      "x-scheme-handler/whatsapp=net.shakaran.whatly.desktop;",
    );
    if (Bun.which("gio")) {
      const registered = Bun.spawnSync([Bun.which("gio")!, "mime", "x-scheme-handler/whatsapp"], {
        env: {
          ...f.env,
          XDG_CONFIG_HOME: join(f.root, "desktop config"),
          XDG_CONFIG_DIRS: join(f.root, "system config"),
          XDG_DATA_DIRS: join(f.root, "system data"),
          GIO_USE_VFS: "local",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(registered.exitCode, registered.stderr.toString()).toBe(0);
      expect(registered.stdout.toString()).toContain("net.shakaran.whatly.desktop");
      rmSync(f.env.TEST_LAUNCH_LOG);
      const opened = Bun.spawnSync([Bun.which("gio")!, "launch", desktop, args[0]!], {
        env: { ...f.env, GIO_USE_VFS: "local" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(opened.exitCode, opened.stderr.toString()).toBe(0);
      const deadline = Date.now() + 2000;
      while (!existsSync(f.env.TEST_LAUNCH_LOG) && Date.now() < deadline) await Bun.sleep(10);
      expect(readFileSync(f.env.TEST_LAUNCH_LOG, "utf8")).toBe("|\n" + args[0] + "\n");
    }
    const calls = readFileSync(f.commands, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(calls).toContainEqual([
      "-C",
      join(f.build, "src/libnotify-qt"),
      "checkout",
      "--detach",
      "b".repeat(40),
    ]);
    // Failed rebuilds invalidate old staging before after_build can reuse it.
    f.write(join(prefix, "preserve"), "previous install");
    const failed = f.run("build", { TEST_BUILD_FAIL: "1" });
    expect(failed.exitCode).toBe(1);
    expect(f.run("install").stderr.toString()).toContain("build did not finish");
    expect(readFileSync(join(prefix, "preserve"), "utf8")).toBe("previous install");
    expect(f.run("build").exitCode).toBe(0);
    expect(f.run("install").exitCode).toBe(0);
    expect(existsSync(join(prefix, "preserve"))).toBe(false);
    expect(readFileSync(session, "utf8")).toBe("personal session");
  } finally {
    f.cleanup();
  }
});

test("Whatly refuses linked desktop destinations before publishing any native update", () => {
  const f = fixture();
  try {
    expect(f.run("build").exitCode).toBe(0);
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    mkdirSync(f.data, { recursive: true });
    symlinkSync(outside, join(f.data, "applications"));
    const result = f.run("install");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("ordinary files or directories");
    expect(existsSync(join(f.install, "whatly"))).toBe(false);
    expect(existsSync(join(outside, "net.shakaran.whatly.desktop"))).toBe(false);
  } finally {
    f.cleanup();
  }
});

test("Whatly's indexed manifest declares native build and configuration hooks", async () => {
  const root = mkdtempSync(join(tmpdir(), "luna-whatly-catalog-"));
  try {
    const context = await appContext({ repository, env: { HOME: root } });
    const catalog = await readCatalog(context);
    const manifest = catalog.find((app) => app.id === "whatly")!.manifest;
    expect(manifest.url).toBe("https://github.com/dot-luna/whatly.git");
    expect(manifest.processes).toEqual(["whatly"]);
    expect(manifest.exports).toBeUndefined();
    expect(manifest.hooks?.before_configure).toBeUndefined();
    expect(manifest.hooks?.after_configure).toEqual(["scripts/configure.ts"]);
    expect(manifest.deps?.map((dependency) => dependency.name)).toEqual(
      expect.arrayContaining([
        "gcc",
        "desktop-file-utils",
        "cmake",
        "ninja",
        "qt6-tools",
        "qt6-webengine",
        "qt6-wayland",
        "libx11",
        "libxcb",
      ]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
