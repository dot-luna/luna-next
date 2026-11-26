#!/usr/bin/env bun
import { Luna } from "../packages/luna-api/src/index.ts";

const installed = await Luna.apps.installed(["hypr", "luna-login"]);
if (!installed.succes) throw new Error(installed.errMessage);
const login = await Luna.login.status();
if (!login.succes) throw new Error(login.errMessage);

if (installed.data.length || login.data.installed) {
  // Configuration deploys a standalone SDDM theme for the next login without ending this session.
  const result = await Luna.apps.install(["luna-login"], { closeApps: false });
  if (!result.succes) throw new Error(result.errMessage);
}
