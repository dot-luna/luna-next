import { expect, test } from "bun:test";
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Luna } from "../../../packages/luna-api/src/index.ts";
import { AppFixture } from "../../../packages/luna-api/tests/fixtures/app-fixture.ts";

test("GTK windows request compositor blur before personal styles", async () => {
  const f = new AppFixture();
  try {
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    cpSync(join(repo, "apps/gtk"), join(f.repository, "apps/gtk"), { recursive: true });
    f.write(f.repository, "apps/apps.jsonc", '{"packages":["gtk/app.jsonc"]}');
    f.write(f.home, ".config/gtk-4.0/gtk.css", "window { opacity: 1; }\n");
    const options = { repository: f.repository, env: f.env };
    expect(await Luna.apps.configure(["gtk"], options)).toMatchObject({ succes: true });
    expect(await Luna.apps.configure(["gtk"], options)).toMatchObject({ succes: true });

    const exported = join(f.home, ".config/luna/gtk-4.0/gtk.css");
    expect(readFileSync(exported, "utf8")).toMatch(/window\s*\{[^}]*backdrop-filter:\s*blur\(/u);
    const personal = readFileSync(join(f.home, ".config/gtk-4.0/gtk.css"), "utf8");
    const imports = personal.match(/@import url\("([^"]+)"\);/gu) ?? [];
    expect(imports).toEqual([`@import url("${pathToFileURL(exported).href}");`]);
    expect(personal.indexOf("@import")).toBeLessThan(personal.indexOf("window { opacity"));
  } finally {
    f.dispose();
  }
});
