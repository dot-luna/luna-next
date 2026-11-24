import { webapp } from "./index.ts";
import { browserLinkRequestSchema, type BrowserLinkConfig } from "./schema.ts";

type BrowserLinkCommandOptions = {
  args: string[];
  env: Record<string, string>;
};

/** Route browser requests without retaining installed origins or session state. */
class WebappBrowserLinks {
  /** Resolve registered web apps on each request, including apps installed since Chromium started. */
  private async _getOrigins({
    config,
    env,
  }: {
    config: BrowserLinkConfig;
    env: Record<string, string>;
  }) {
    const apps = await webapp.list({
      env,
      dataDir: config.dataDir,
      profileRoot: config.profileRoot,
    });
    if (!apps.succes) throw new Error(apps.errMessage);
    const appOrigins = [...new Set(apps.data.map((app) => new URL(app.url).origin))].sort();
    return { appOrigins, origins: [...new Set([...appOrigins, ...config.extraOrigins])].sort() };
  }

  /** Run literal arguments without a shell; report command failures with their diagnostics. */
  private async _runCommand({ args, env }: BrowserLinkCommandOptions) {
    const child = Bun.spawn(args, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [code, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (code !== 0) throw new Error(error.trim() || `${args[0]} failed (${code})`);
    return output.trim();
  }

  /**
   * Validate a native request and return current origins. External URLs open only
   * when the source belongs to an installed app.
   * The caller supplies validated config. GIO uses desktop MIME defaults without shell
   * interpolation; invalid requests, metadata, unsafe default handlers, and command failures throw.
   */
  async route({
    request,
    config,
    env,
    run = this._runCommand,
  }: {
    request: unknown;
    config: BrowserLinkConfig;
    env: Record<string, string>;
    run?: (options: BrowserLinkCommandOptions) => Promise<string>;
  }) {
    const message = browserLinkRequestSchema.parse(request);
    const { origins, appOrigins } = await this._getOrigins({ config, env });
    if (message.type === "origins") return { origins, appOrigins, opened: false };
    if (
      !appOrigins.includes(new URL(message.source).origin) ||
      origins.includes(new URL(message.url).origin)
    )
      return { origins, appOrigins, opened: false };
    const cleanEnvironment = { ...env };
    // Do not carry Luna's Chromium-specific directory overrides into another browser.
    delete cleanEnvironment.CHROME_USER_DATA_DIR;
    delete cleanEnvironment.CHROME_CONFIG_HOME;
    delete cleanEnvironment.BROWSER;
    const scheme = new URL(message.url).protocol.slice(0, -1);
    const desktop = await run({
      args: ["xdg-mime", "query", "default", `x-scheme-handler/${scheme}`],
      env: cleanEnvironment,
    });
    if (!desktop || /chromium|luna-webapp/iu.test(desktop))
      throw new Error(
        "Choose a default browser other than Luna's Chromium to open external links.",
      );
    await run({ args: ["gio", "open", message.url], env: cleanEnvironment });
    return { origins, appOrigins, opened: true };
  }
}

export const webappBrowserLinks = new WebappBrowserLinks();
