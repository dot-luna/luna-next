#!/usr/bin/env bun
import { replaceWhatly } from "../packages/luna-api/src/modules/self/migrations/releases/whatsapp.ts";

await replaceWhatly({ onProgress: (message) => console.error(message) });
