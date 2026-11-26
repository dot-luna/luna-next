#!/usr/bin/env bun
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { Luna } from "../packages/luna-api/src/index.ts";
import { metadata } from "../packages/luna-api/src/lib/files.ts";
import { ordinaryParents } from "../packages/luna-api/src/lib/paths.ts";

const installed = await Luna.apps.installed(["hypr", "luna-polkit"]);
if (!installed.succes) throw new Error(installed.errMessage);

if (installed.data.length) {
  const result = await Luna.apps.install(["luna-polkit"], { closeApps: false });
  if (!result.succes) throw new Error(result.errMessage);
  // Respect an explicitly disabled manifest: keep the previous login agent in that case.
  if (result.data.installed.includes("luna-polkit")) {
    const config = Bun.env.XDG_CONFIG_HOME || join(Bun.env.HOME!, ".config");
    const unit = join(config, "systemd/user/luna-next-polkit.service");
    await ordinaryParents(unit);
    if (await metadata(unit)) {
      // Disable future startup without cancelling the current authentication session.
      const disable = Bun.spawn(["systemctl", "--user", "disable", "luna-next-polkit.service"], {
        stdout: "inherit",
        stderr: "inherit",
      });
      if ((await disable.exited) !== 0)
        throw new Error("Could not disable the obsolete Luna polkit service");
      await rm(unit);
      const reload = Bun.spawn(["systemctl", "--user", "daemon-reload"], {
        stdout: "inherit",
        stderr: "inherit",
      });
      if ((await reload.exited) !== 0) throw new Error("Could not reload user services");
    }
    if (installed.data.includes("hypr")) {
      const configured = await Luna.apps.configure(["hypr"], { closeApps: false });
      if (!configured.succes) throw new Error(configured.errMessage);
    }
    // Keep an in-flight authentication conversation intact. The new agent takes over at login.
    console.log("Luna Polkit installed. Log out and back in to use the new authentication agent.");
  }
}
