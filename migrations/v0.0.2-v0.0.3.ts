#!/usr/bin/env bun
import { replaceWhatly } from "../packages/luna-api/src/self/migrations/releases/whatsapp.ts";

await replaceWhatly({ onProgress: (message) => console.error(message) });
