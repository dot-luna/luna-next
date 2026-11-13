import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Luna } from "../../../packages/luna-api/src/index.ts";
import { AppFixture } from "../../../packages/luna-api/tests/fixtures/app-fixture.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const account = "00000000-0000-4000-8000-000000000000";
const finished = {
  global_account_activeAccountId: account,
  [`user_${account}_vaultTimeoutSettings_vaultTimeout`]: 240,
  [`user_${account}_biometricSettings_biometricUnlockEnabled`]: true,
};

test("Bitwarden defaults fill missing global settings and keep existing state and choices", async () => {
  const f = new AppFixture();
  try {
    cpSync(join(repo, "apps/bitwarden"), join(f.repository, "apps/bitwarden"), {
      recursive: true,
    });
    f.write(f.repository, "apps/apps.jsonc", '{"packages":["bitwarden/app.jsonc"]}');
    const state = { stateVersion: 75, global_desktopSettings_startToTray: false, ...finished };
    f.write(f.home, ".config/Bitwarden/data.json", JSON.stringify(state));
    expect(
      await Luna.apps.configure(["bitwarden"], { repository: f.repository, env: f.env }),
    ).toMatchObject({ succes: true });
    expect(JSON.parse(readFileSync(join(f.home, ".config/Bitwarden/data.json"), "utf8"))).toEqual({
      ...state,
      global_desktopSettings_trayEnabled: true,
      global_desktopSettings_closeToTray: true,
      global_desktopSettings_browserIntegrationEnabled: true,
      global_theming_selection: "dark",
    });
  } finally {
    f.dispose();
  }
});

// setsid drops the controlling terminal so the reminder stays out of the test output.
const remind = (state?: Record<string, unknown>) => {
  const root = mkdtempSync(join(tmpdir(), "luna-bitwarden-"));
  try {
    if (state) {
      mkdirSync(join(root, "Bitwarden"));
      writeFileSync(join(root, "Bitwarden/data.json"), JSON.stringify(state));
    }
    const result = Bun.spawnSync(
      ["setsid", "-w", process.execPath, join(repo, "apps/bitwarden/scripts/remind.ts")],
      { env: { HOME: root, XDG_CONFIG_HOME: root }, stdin: "ignore" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return result.stdout.toString();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("Bitwarden reminds about per-account settings until they are set", () => {
  expect(remind()).toBe(
    [
      "Bitwarden: finish setup in the app",
      "  - Log in",
      "  - Settings → Security: choose a vault timeout",
      "  - Settings → Security: turn on Unlock with system authentication",
      "",
    ].join("\n"),
  );
  const { [`user_${account}_biometricSettings_biometricUnlockEnabled`]: _, ...partial } = finished;
  expect(remind(partial)).toBe(
    "Bitwarden: finish setup in the app\n  - Settings → Security: turn on Unlock with system authentication\n",
  );
  expect(remind(finished)).toBe("");
});
