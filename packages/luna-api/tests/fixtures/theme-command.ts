import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const env = process.env;
const args = Bun.argv.slice(2);
const [operation, , key] = args;
const settings = {
  "color-scheme": { path: env.THEME_PREFERENCE!, default: "'default'" },
  "gtk-theme": { path: env.LUNA_TEST_GTK_THEME!, default: "'Adwaita'" },
};
if (!(key! in settings)) throw new Error(`Unexpected GSettings key: ${key}`);
const setting = settings[key as keyof typeof settings];
function save(key: string, value: string) {
  const path = settings[key as keyof typeof settings].path;
  // Existing mode fixtures use enum names; GTK strings retain their GVariant quoting.
  writeFileSync(path, key === "color-scheme" ? value.replace(/^'|'$/gu, "") : value);
}
appendFileSync(env.THEME_LOG!, JSON.stringify(args) + "\n");

type Fault = {
  operation: string;
  key: string;
  occurrence?: number;
  save?: boolean;
  fail?: boolean;
  external?: Record<string, string>;
  selection?: string;
  files?: Record<string, string>;
};
const configuredFault = env.LUNA_TEST_GSETTINGS_FAULT
  ? (JSON.parse(env.LUNA_TEST_GSETTINGS_FAULT) as Fault | Fault[])
  : [];
const faults = Array.isArray(configuredFault) ? configuredFault : [configuredFault];
const occurrence = readFileSync(env.THEME_LOG!, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as string[])
  .filter((command) => command[0] === operation && command[2] === key).length;
const fault = faults.find(
  (rule) =>
    rule.operation === operation && rule.key === key && (rule.occurrence ?? 1) === occurrence,
);
if (fault) {
  if (operation === "set" && fault.save) save(key!, args.at(-1)!);
  for (const [externalKey, value] of Object.entries(fault.external ?? {})) save(externalKey, value);
  if (fault.selection !== undefined) writeFileSync(env.THEME_CONFIG!, fault.selection);
  for (const [path, value] of Object.entries(fault.files ?? {})) writeFileSync(path, value);
  if (fault.fail) {
    console.error("simulated GSettings failure");
    process.exit(17);
  }
}

if (operation === "get") {
  const value = existsSync(setting.path) ? readFileSync(setting.path, "utf8") : setting.default;
  console.log(key === "color-scheme" ? `'${value.replace(/^'|'$/gu, "")}'` : value);
} else if (operation === "set" && !fault) {
  if (env.THEME_FAIL_ONCE && !existsSync(env.THEME_MARKER!)) {
    writeFileSync(env.THEME_MARKER!, "failed");
    save(key!, env.THEME_EXTERNAL_MODE ?? args.at(-1)!);
    if (env.THEME_EXTERNAL_EDIT) writeFileSync(env.THEME_CONFIG!, env.THEME_EXTERNAL_EDIT);
    console.error("simulated GSettings failure");
    process.exit(17);
  }
  save(key!, args.at(-1)!);
}
