#!/usr/bin/env bun
import { Luna } from "../../../packages/luna-api/src/index.ts";

const result = await Luna.login.install();
if (!result.succes) throw new Error(result.errMessage);
