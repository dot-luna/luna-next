#!/usr/bin/env bun
import { runCli } from "./cli.ts";

// Bun exposes the process exit status through this compatibility global.
if (import.meta.main) process.exitCode = await runCli(Bun.argv.slice(2));
