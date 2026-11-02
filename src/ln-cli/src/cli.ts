import { Command, CommanderError } from "commander";
import { createApps, serializeResponse, type ApiResponse } from "luna-api";
import { createLogger } from "luna-logger";
import { appInfo, batchResult } from "./format.ts";

interface GlobalOptions {
  json?: boolean;
  repo?: string;
  verbose?: boolean;
  color?: boolean;
}

/** Parse and present only; the API owns app discovery, validation, and side effects. */
export async function runCli(argv: string[]): Promise<number> {
  let exitCode = 0;
  const delimiter = argv.indexOf("--");
  const wantsJson = argv.slice(0, delimiter < 0 ? undefined : delimiter).includes("--json");
  const stdout = Bun.stdout.writer();
  const stderr = Bun.stderr.writer();
  const writeOut = (text: string) => { stdout.write(text); stdout.flush(); };
  const writeErr = (text: string) => { stderr.write(text); stderr.flush(); };

  const program = new Command()
    .name("luna")
    .description("Manage Luna apps")
    .version("0.1.0")
    .option("--json", "Return a standard JSON response")
    .option("--repo <path>", "Use this checkout instead of LUNA_NEXT_ROOT")
    .option("--verbose", "Include diagnostic logs")
    .option("--no-color", "Disable log colors")
    .exitOverride()
    .configureOutput({ writeOut, writeErr: wantsJson ? () => {} : writeErr });

  const options = () => program.opts<GlobalOptions>();
  const apps = () => createApps({
    repository: options().repo,
    logger: createLogger({ name: "luna", level: options().verbose ? "debug" : "warn", color: options().color === false ? false : undefined }),
  });

  function publish<T>(response: ApiResponse<T>, render: (result: T) => string): void {
    if (options().json) {
      writeOut(serializeResponse(response));
    } else if (response.ok) {
      const text = render(response.result);
      if (text) writeOut(text + "\n");
    } else {
      writeErr(`${response.error.code}: ${response.error.message}\n`);
      // Batch details include earlier successes and apps that were never attempted.
      if (response.error.code === "BATCH_FAILED" && response.error.details) {
        writeErr(JSON.stringify(response.error.details, null, 2) + "\n");
      }
    }
    if (!response.ok) exitCode = 1;
  }

  program.command("list").description("List app manifests").action(async () => {
    publish(await apps().list(), values => values.map(app => `${app.id}\t${app.manifest.source}\t${app.manifest.name}`).join("\n"));
  });
  program.command("info <app>").description("Show an app and its supported actions").action(async (name: string) => {
    publish(await apps().info(name), appInfo);
  });

  for (const [action, description, required] of [
    ["install", "Install packages and configure apps", false],
    ["uninstall", "Remove packages, preserving personal data and settings", true],
    ["update", "Update installed apps and refresh configuration", false],
    ["configure", "Replace declared exports and run configuration hooks", false],
    ["start", "Start supported apps or services", true],
    ["stop", "Stop supported apps or services", true],
    ["reload", "Reload supported apps without restarting", true],
    ["restart", "Restart supported apps or services", true],
    ["status", "Report installation and supported runtime state", false],
  ] as const) {
    const command = program.command(`${action} ${required ? "<apps...>" : "[apps...]"}`).description(description);
    if (action === "configure") command.alias("conf");
    command.action(async (names: string[]) => publish(await apps()[action](names), batchResult));
  }

  try {
    if (!argv.length) program.outputHelp();
    else await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) return 0;
      if (wantsJson) writeOut(serializeResponse({ ok: false, error: { code: "INVALID_ARGUMENT", message: error.message } }));
      return 2;
    }
    publish({ ok: false, error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) } }, () => "");
  }
  return exitCode;
}
