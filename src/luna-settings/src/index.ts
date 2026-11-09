import { Luna } from "@luna/api";

// Resolve the theme once through the API; QML receives a snapshot, not config files.
const theme = await Luna.theme.get();
if (!theme.succes) {
  console.error(theme.errMessage);
  process.exit(1);
}

const window = Bun.spawn(["qs", "-p", `${import.meta.dir}/shell`], {
  env: { ...Bun.env, LUNA_SETTINGS_THEME: JSON.stringify(theme.data) },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.on("SIGINT", () => window.kill("SIGINT"));
process.on("SIGTERM", () => window.kill("SIGTERM"));
process.exit(await window.exited);
