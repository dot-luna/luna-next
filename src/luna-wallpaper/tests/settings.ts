import { Luna } from "../../../packages/luna-api/src/index.ts";

// Exercise the public loader rather than maintaining a second parser in Python.
const result = await Luna.wallpaper.get(undefined, { configFile: process.argv[2] });
if (!result.succes) {
  console.error(result.errMessage);
  process.exit(1);
}
process.stdout.write(JSON.stringify(result.data));
