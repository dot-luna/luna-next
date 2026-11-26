import { wallpaperConfig } from "../../../packages/luna-api/src/modules/wallpaper/config.ts";

// The renderer owns this child; only API-validated JSON snapshots reach its stdout.
const configFile = process.argv[2];
if (!configFile) throw new Error("A wallpaper configuration path is required");
const close = await wallpaperConfig.follow({ configFile }, (settings) => {
  process.stdout.write(JSON.stringify(settings) + "\n");
});
process.on("SIGTERM", close);
process.on("SIGINT", close);
