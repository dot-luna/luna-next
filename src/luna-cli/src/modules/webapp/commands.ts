import {
  Luna,
  type WebappInstallOptions,
  type WebappLaunchOptions,
  type WebappOptions,
} from "@luna/api";
import type { Command } from "commander";
import type { createOutput } from "@/lib/output.ts";
import { promptForm } from "@/lib/prompts.ts";

/** Register web app arguments and output; validation and operations stay in Luna API. */
export function addWebappCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  json: boolean,
  setExitCode: (code: number) => void,
) {
  const group = program
    .command("webapp")
    .description("Manage web apps in Luna's Chromium profile")
    .option("--data-dir <path>", "Web app metadata and icon directory")
    .option("--applications-dir <path>", "Desktop entry directory")
    .option("--launcher <path>", "Installed Luna executable")
    .option("--profile-root <path>", "Chromium user-data directory containing the Luna profile")
    .option("--chromium <path>", "Chromium executable");

  // Prompt only for missing required inputs outside JSON mode; icons remain optional.
  const installCommand = group
    .command("install [name] [url]")
    .description("Install a web app; prompt for missing name or URL")
    .option("--icon <path-or-url>", "Copy a local icon or download an image URL")
    .action(async (name?: string, url?: string) => {
      if ((!name || !url) && !json) {
        const answers = await promptForm(async (ask) => ({
          name: name || (await ask("Web app name: ")),
          url: url || (await ask("Web app URL: ")),
        }));
        name = answers?.name;
        url = answers?.url;
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
      // Resolve parser options at action time, after Commander has consumed all arguments.
      const response = await Luna.webapp.install(name, url, {
        ...group.opts<WebappOptions>(),
        ...installCommand.opts<Pick<WebappInstallOptions, "icon">>(),
      });
      setExitCode(output.response(response, (app) => `Installed web app: ${app.name}`));
    });

  // Commander defaults these negated flags to true; either flag explicitly opts out.
  const launchCommand = group
    .command("launch <name>")
    .description("Fuzzy-match a web app name and focus or open it")
    .option("--no-focus-existing", "Open a new window instead of focusing an existing one")
    .option("--no-fuzzy", "Require the exact installed app name")
    .action(async (name: string) => {
      const response = await Luna.webapp.launch(name, {
        ...group.opts<WebappOptions>(),
        ...launchCommand.opts<Pick<WebappLaunchOptions, "focusExisting" | "fuzzy">>(),
      });
      setExitCode(
        output.response(response, (app) =>
          `${app.action === "focused" ? "Focused" : "Opened"} web app: ${app.name}`,
        ),
      );
    });

  // Human output shows names and URLs; JSON preserves the complete API records.
  group
    .command("list")
    .description("List installed web apps")
    .action(async () => {
      const response = await Luna.webapp.list(group.opts<WebappOptions>());
      setExitCode(
        output.response(response, (apps) =>
          apps.map((app) => `${app.name}  ${app.url}`).join("\n"),
        ),
      );
    });

  // Removal always requires an exact name so fuzzy matching cannot remove another app.
  group
    .command("uninstall <name>")
    .description("Remove the exact named web app; retain browser data")
    .action(async (name: string) => {
      const response = await Luna.webapp.uninstall(name, group.opts<WebappOptions>());
      setExitCode(output.response(response, (app) => `Removed web app: ${app.name}`));
    });
}
