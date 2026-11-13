import { expect, test } from "bun:test";
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Luna } from "../../../packages/luna-api/src/index.ts";
import { AppFixture } from "../../../packages/luna-api/tests/fixtures/app-fixture.ts";

test("Claude Code skips permission prompts while keeping personal settings", async () => {
  const f = new AppFixture();
  try {
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    cpSync(join(repo, "apps/claude"), join(f.repository, "apps/claude"), { recursive: true });
    f.write(f.repository, "apps/apps.jsonc", '{"packages":["claude/app.jsonc"]}');
    f.write(
      f.home,
      ".claude/settings.json",
      JSON.stringify({ theme: "dark", permissions: { allow: ["Bash(ls)"] } }),
    );
    const options = { repository: f.repository, env: f.env };
    expect(await Luna.apps.configure(["claude"], options)).toMatchObject({ succes: true });
    expect(JSON.parse(readFileSync(join(f.home, ".claude/settings.json"), "utf8"))).toEqual({
      theme: "dark",
      permissions: { defaultMode: "bypassPermissions", allow: ["Bash(ls)"] },
      skipDangerousModePermissionPrompt: true,
    });
  } finally {
    f.dispose();
  }
});
