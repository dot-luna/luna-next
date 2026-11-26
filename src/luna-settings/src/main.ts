import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { Luna } from "@luna/api";

/** Supply the shared theme and the wallpaper API bridge to Quickshell. */
async function run() {
  const theme = await Luna.theme.get();
  if (!theme.succes) throw new Error(theme.errMessage);
  const executable = Bun.which("qs") ?? Bun.which("quickshell");
  if (!executable) throw new Error("Install Quickshell to open Luna Settings");

  const child = Bun.spawn([executable, "-p", fileURLToPath(new URL("./shell", import.meta.url))], {
    env: {
      ...Bun.env,
      LUNA_SETTINGS_THEME: JSON.stringify(theme.data),
      // Let the desktop portal choose the system file picker rather than Qt Quick's fallback.
      QT_QPA_PLATFORMTHEME: "xdgdesktopportal",
      LUNA_SETTINGS_BACKGROUND_COMMAND: JSON.stringify([
        process.execPath,
        fileURLToPath(new URL("./backgrounds.ts", import.meta.url)),
      ]),
      QML_IMPORT_PATH: [
        fileURLToPath(new URL("../../../packages/luna-ui/src", import.meta.url)),
        Bun.env.QML_IMPORT_PATH,
      ]
        .filter(Boolean)
        .join(delimiter),
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    return await child.exited;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await run();
  } catch (error) {
    console.error(`Luna Settings: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
