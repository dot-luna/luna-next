import { expect, test } from "bun:test";
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Luna } from "../../../packages/luna-api/src/index.ts";
import { AppFixture } from "../../../packages/luna-api/tests/fixtures/app-fixture.ts";

test("mpv gains Luna's playback defaults and bindings while personal lines win", async () => {
  const f = new AppFixture();
  try {
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    cpSync(join(repo, "apps/mpv"), join(f.repository, "apps/mpv"), { recursive: true });
    f.write(f.repository, "apps/apps.jsonc", '{"packages":["mpv/app.jsonc"]}');
    f.write(f.home, ".config/mpv/mpv.conf", "speed=1\n");
    f.write(f.home, ".config/mpv/input.conf", "UP add volume 1\n");
    const options = { repository: f.repository, env: f.env };
    expect(await Luna.apps.configure(["mpv"], options)).toMatchObject({ succes: true });
    expect(await Luna.apps.configure(["mpv"], options)).toMatchObject({ succes: true });

    const config = readFileSync(join(f.home, ".config/mpv/mpv.conf"), "utf8").split("\n");
    expect(config.filter((line) => line.startsWith("speed="))).toEqual(["speed=1"]);
    for (const line of ["save-position-on-quit=yes", "osd-bar-align-y=0.80", "hwdec=auto-safe"])
      expect(config).toContain(line);
    const input = readFileSync(join(f.home, ".config/mpv/input.conf"), "utf8").split("\n");
    expect(input.filter((line) => line.startsWith("UP "))).toEqual(["UP add volume 1"]);
    for (const line of [
      "DOWN add volume -5",
      "[ add speed -0.25",
      "] add speed 0.25",
      "Meta+w quit",
    ])
      expect(input).toContain(line);
  } finally {
    f.dispose();
  }
});
