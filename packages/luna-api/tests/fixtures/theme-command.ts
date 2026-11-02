import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const env = process.env;
const args = Bun.argv.slice(2);
appendFileSync(env.THEME_LOG!, JSON.stringify(args) + "\n");
if (args[0] === "get")
  console.log(
    `'${existsSync(env.THEME_PREFERENCE!) ? readFileSync(env.THEME_PREFERENCE!, "utf8") : "default"}'`,
  );
else if (args[0] === "set") {
  if (env.THEME_FAIL_ONCE && !existsSync(env.THEME_MARKER!)) {
    writeFileSync(env.THEME_MARKER!, "failed");
    writeFileSync(env.THEME_PREFERENCE!, env.THEME_EXTERNAL_MODE ?? args.at(-1)!);
    if (env.THEME_EXTERNAL_EDIT) writeFileSync(env.THEME_CONFIG!, env.THEME_EXTERNAL_EDIT);
    console.error("simulated GSettings failure");
    process.exit(17);
  }
  writeFileSync(env.THEME_PREFERENCE!, args.at(-1)!);
}
