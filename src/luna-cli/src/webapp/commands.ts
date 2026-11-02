import { Luna, type WebappOptions } from "@luna/api";
import type { Command } from "commander";
import type { createOutput } from "../lib/output.ts";
import { promptForm } from "../lib/prompts.ts";

export function addWebappCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  json: boolean,
  setExitCode: (value: number) => void,
) {
  const group = program
    .command("webapp")
    .description("Manage web apps in Luna's Chromium profile")
    .option("--data-dir <path>", "Web app metadata directory")
    .option("--applications-dir <path>", "Desktop entry directory")
    .option("--launcher <path>", "Installed Luna executable")
    .option("--profile-root <path>", "Chromium user-data directory containing the Luna profile")
    .option("--chromium <path>", "Chromium executable");
  const options = () => group.opts<WebappOptions>();
  group
    .command("install [name] [url]")
    .description("Install a web app; prompt for missing name or URL")
    .action(async (name?: string, url?: string) => {
      if ((!name || !url) && !json) {
        const answer = await promptForm(async (ask) => ({
          name: name || (await ask("Web app name: ")),
          url: url || (await ask("Web app URL: ")),
        }));
        name = answer?.name;
        url = answer?.url;
      }
      if (!name || !url) {
        setExitCode(
          output.response(
            { succes: false, err: "INPUT_REQUIRED", errMessage: "Provide a web app name and URL" },
            () => "",
          ),
        );
        return;
      }
      setExitCode(
        output.response(
          await Luna.webapp.install(name, url, options()),
          (data) => `Installed web app: ${data.name}`,
        ),
      );
    });
  group
    .command("uninstall <name>")
    .description("Remove a web app launcher; retain browser data")
    .action(async (name: string) => {
      setExitCode(
        output.response(
          await Luna.webapp.uninstall(name, options()),
          (data) => `Removed web app: ${data.name}`,
        ),
      );
    });
  group
    .command("list")
    .description("List installed web apps")
    .action(async () => {
      setExitCode(
        output.response(await Luna.webapp.list(options()), (data) =>
          data.map((app) => `${app.name}  ${app.url}`).join("\n"),
        ),
      );
    });
  group
    .command("launch <name>")
    .description("Open a web app in Chromium app mode")
    .action(async (name: string) => {
      setExitCode(
        output.response(
          await Luna.webapp.launch(name, options()),
          (data) => `Launched web app: ${data.name}`,
        ),
      );
    });
}
