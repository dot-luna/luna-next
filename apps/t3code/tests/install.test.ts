import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const hook = resolve(import.meta.dir, "../scripts/install.ts");

test("installed T3 launcher retains concrete artifact/theme/profile paths and forwards arguments", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-t3-install ' % $ "));
  const home = join(root, "home");
  const build = join(root, "build/t3code");
  const install = join(root, "custom install");
  const data = join(root, "custom data");
  const config = join(root, "custom config");
  const userdata = join(root, "custom t3");
  const write = (file: string, text: string, mode = 0o644) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { mode });
  };
  try {
    write(
      join(build, ".luna-build.json"),
      JSON.stringify({ version: "v1.0.0", revision: "abcdef", square: true, built: true }),
    );
    write(
      join(build, "generated/artifacts/T3-Code-x86_64.AppImage"),
      `#!${process.execPath}\nawait Bun.write(process.env.TEST_LAUNCH_LOG!,JSON.stringify({args:Bun.argv.slice(2),config:process.env.LUNA_CONFIG_HOME_DIR,data:process.env.LUNA_DATA_HOME_DIR,profile:process.env.T3CODE_HOME,launcher:process.env.T3CODE_DESKTOP_LAUNCHER_PATH,auto:process.env.T3CODE_DISABLE_AUTO_UPDATE,appimage:process.env.APPIMAGE??null,appdir:process.env.APPDIR??null}));\n`,
    );
    const luna = join(home, ".local/bin/luna");
    write(
      luna,
      '#!/bin/bash\nprintf "%s\\n" "$@" > "$TEST_THEME_LOG"\nexit "${TEST_THEME_FAIL:-0}"\n',
      0o755,
    );
    write(join(userdata, "userdata/settings.json"), '{"preserve":true}');
    const env = {
      HOME: home,
      PATH: "/usr/bin:/bin",
      LUNA_GIT_APP_BUILD_DIR: dirname(build),
      LUNA_GIT_APP_INSTALL_DIR: install,
      XDG_DATA_HOME: data,
      LUNA_CONFIG_HOME_DIR: config,
      LUNA_DATA_HOME_DIR: join(root, "luna data"),
      T3CODE_HOME: userdata,
    };
    const built = Bun.spawnSync([process.execPath, hook], { env, stdout: "pipe", stderr: "pipe" });
    expect(built.exitCode, built.stderr.toString()).toBe(0);
    const launcher = join(home, ".local/bin/t3code");
    const launchLog = join(root, "launch.json");
    const themeLog = join(root, "theme.log");
    const desktopEnv = {
      HOME: home,
      PATH: "/usr/bin:/bin",
      TEST_LAUNCH_LOG: launchLog,
      TEST_THEME_LOG: themeLog,
      APPIMAGE: "stale",
      APPDIR: "stale",
    };
    const args = ['t3code://open/path?value="one"', "--flag", "quote '$`% "];
    const launched = Bun.spawnSync([launcher, ...args], {
      env: desktopEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(launched.exitCode, launched.stderr.toString()).toBe(0);
    expect(JSON.parse(readFileSync(launchLog, "utf8"))).toEqual({
      args,
      config,
      data: env.LUNA_DATA_HOME_DIR,
      profile: userdata,
      launcher,
      auto: "true",
      appimage: null,
      appdir: null,
    });
    expect(readFileSync(themeLog, "utf8")).toBe("theme\napply\nt3code\n");
    expect(existsSync(join(install, "t3code/T3-Code.AppImage"))).toBe(true);
    expect(readFileSync(join(userdata, "userdata/settings.json"), "utf8")).toBe(
      '{"preserve":true}',
    );
    const override = join(root, "runtime profile");
    expect(
      Bun.spawnSync([launcher], {
        env: { ...desktopEnv, T3CODE_HOME: override },
        stdout: "pipe",
        stderr: "pipe",
      }).exitCode,
    ).toBe(0);
    expect(JSON.parse(readFileSync(launchLog, "utf8")).profile).toBe(override);
    writeFileSync(launchLog, "unchanged");
    expect(
      Bun.spawnSync([launcher], {
        env: { ...desktopEnv, TEST_THEME_FAIL: "9" },
        stdout: "pipe",
        stderr: "pipe",
      }).exitCode,
    ).toBe(9);
    expect(readFileSync(launchLog, "utf8")).toBe("unchanged");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
