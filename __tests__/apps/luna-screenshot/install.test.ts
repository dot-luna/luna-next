import { expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Luna } from "../../../packages/luna-api/src/index.ts";
import { AppFixture } from "../../../packages/luna-api/tests/fixtures/app-fixture.ts";

test("screenshot installs its capture tools through the catalog without changing personal settings", async () => {
  const fixture = new AppFixture();
  try {
    const source = fileURLToPath(
      new URL("../../../apps/luna-screenshot/app.jsonc", import.meta.url),
    );
    const app = join(fixture.repository, "apps/luna-screenshot");
    mkdirSync(app, { recursive: true });
    cpSync(source, join(app, "app.jsonc"));
    fixture.write(
      fixture.repository,
      "apps/apps.jsonc",
      '{"packages":["luna-screenshot/app.jsonc"]}',
    );
    fixture.write(fixture.home, ".config/luna/personal.jsonc", '{"keep":true}\n');
    const options = { repository: fixture.repository, env: fixture.env };
    expect(await Luna.apps.install(["luna-screenshot"], options)).toMatchObject({
      succes: true,
      data: { installed: ["luna-screenshot"], completed: true },
    });
    for (const tool of ["grim", "slurp", "wl-clipboard", "libnotify"])
      expect(
        fixture.commands().some(({ name, args }) => name === "sudo" && args.includes(tool)),
      ).toBe(true);
    expect(await Luna.apps.configure(["luna-screenshot"], options)).toMatchObject({
      succes: true,
      data: ["luna-screenshot"],
    });
    expect(readFileSync(join(fixture.home, ".config/luna/personal.jsonc"), "utf8")).toBe(
      '{"keep":true}\n',
    );
  } finally {
    fixture.dispose();
  }
});
