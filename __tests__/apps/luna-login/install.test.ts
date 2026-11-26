import { expect, test } from "bun:test";
import { cpSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Luna } from "../../../packages/luna-api/src/index.ts";
import { AppFixture } from "../../../packages/luna-api/tests/fixtures/app-fixture.ts";

test("Login app exports standalone sources and theme settings, activates SDDM safely, and replaces owned exports", async () => {
  const f = new AppFixture();
  try {
    const repository = resolve(import.meta.dir, "../../..");
    cpSync(join(repository, "apps/luna-login"), join(f.repository, "apps/luna-login"), {
      recursive: true,
      filter: (path) => !path.includes("/generated"),
    });
    cpSync(join(repository, "src/luna-login/src"), join(f.repository, "src/luna-login/src"), {
      recursive: true,
    });
    symlinkSync(join(repository, "packages"), join(f.repository, "packages"));
    f.write(f.repository, "apps/apps.jsonc", '{"packages":["luna-login/app.jsonc"]}');
    rmSync(join(f.bin, "bun"));
    symlinkSync(process.execPath, join(f.bin, "bun"));
    for (const name of ["mkdir", "mktemp", "cp", "chmod", "rm", "install", "file"])
      symlinkSync(Bun.which(name)!, join(f.bin, name));
    f.env.LUNA_LOGIN_SYSTEM_ROOT = join(f.root, "system");
    const options = { repository: f.repository, env: f.env };
    const installed = await Luna.apps.install(["luna-login"], options);
    expect(installed).toMatchObject({
      succes: true,
      data: { installed: ["luna-login"], completed: true },
    });
    const configRoot = join(f.home, ".config/luna");
    const config = join(configRoot, "login.jsonc");
    const value = Bun.JSONC.parse(readFileSync(config, "utf8"));
    expect(value.screen.path).toBe("./login/screens/default");
    expect(value.theme.colors.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(value.theme.fonts.ui.length).toBeGreaterThan(0);
    expect(readFileSync(join(configRoot, "login/greeter/Main.qml"), "utf8")).toContain(
      "Settings.js",
    );
    expect(await Luna.login.status({ env: f.env })).toMatchObject({
      succes: true,
      data: { installed: true, selected: true },
    });
    f.write(configRoot, "login/obsolete", "remove");
    f.write(configRoot, "untouched", "keep");
    writeFileSync(config, '{"login":{"user":"old"}}');
    expect(await Luna.apps.configure(["luna-login"], options)).toMatchObject({
      succes: true,
      data: ["luna-login"],
    });
    expect(await Bun.file(join(configRoot, "login/obsolete")).exists()).toBe(false);
    expect(Bun.JSONC.parse(readFileSync(config, "utf8")).login.user).toBe("jrtilak");
    expect(readFileSync(join(configRoot, "untouched"), "utf8")).toBe("keep");
    expect(
      f.commands().some((command) => command.name === "sudo" && command.args.includes("sddm")),
    ).toBe(true);
    expect(
      f
        .commands()
        .some((command) => command.args.includes("restart") || command.args.includes("--now")),
    ).toBe(false);
    expect(await Luna.apps.uninstall(["luna-login"], options)).toMatchObject({ succes: true });
    expect(await Luna.login.status({ env: f.env })).toMatchObject({
      succes: true,
      data: { installed: false, selected: false },
    });
    expect(await Bun.file(config).exists()).toBe(true);
  } finally {
    f.dispose();
  }
});
