import { fileURLToPath } from "node:url";
import { Luna } from "@luna/api";

/** Resolve one theme snapshot before starting the mock; settings controls remain local. */
async function run() {
  const theme = await Luna.theme.get();
  if (!theme.succes) throw new Error(theme.errMessage);
  const executable = Bun.which("qs") ?? Bun.which("quickshell");
  if (!executable) throw new Error("Install Quickshell to open Luna Settings");

  const child = Bun.spawn([executable, "-p", fileURLToPath(new URL("./shell", import.meta.url))], {
    env: { ...Bun.env, LUNA_SETTINGS_THEME: JSON.stringify(theme.data) },
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
