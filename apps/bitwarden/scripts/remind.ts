#!/usr/bin/env bun
/**
 * Remind the user about Bitwarden settings Luna cannot set: they are stored per account
 * and only exist after login. Prints nothing once the active account has them.
 *
 * Hook output goes to Luna's install log, so reminders are also written to the
 * controlling terminal when one exists.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const config = Bun.env.XDG_CONFIG_HOME || join(Bun.env.HOME ?? "", ".config");
const file = Bun.file(join(config, "Bitwarden/data.json"));
const state: Record<string, unknown> = (await file.exists()) ? await file.json() : {};
const account = state.global_account_activeAccountId;
const setting = (key: string) =>
  typeof account === "string" ? state[`user_${account}_${key}`] : undefined;

const steps = [
  ...(typeof account === "string" ? [] : ["Log in"]),
  ...(setting("vaultTimeoutSettings_vaultTimeout") === undefined
    ? ["Settings → Security: choose a vault timeout"]
    : []),
  ...(setting("biometricSettings_biometricUnlockEnabled") === true
    ? []
    : ["Settings → Security: turn on Unlock with system authentication"]),
];
if (steps.length) {
  const message = ["Bitwarden: finish setup in the app", ...steps.map((step) => `  - ${step}`)]
    .join("\n")
    .concat("\n");
  process.stdout.write(message);
  try {
    appendFileSync("/dev/tty", message);
  } catch {
    // No controlling terminal, such as a graphical install; the log keeps the reminder.
  }
}
