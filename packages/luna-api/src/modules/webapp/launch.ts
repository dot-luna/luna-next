import { ApiError } from "@/lib/response.ts";
import { webappContext, type WebappContext, type WebappOptions } from "./context.ts";
import { webappWindowsSchema, type WebappLaunchSettings, type WebappRecord } from "./schema.ts";

export type WebappLaunchOptions = WebappOptions & WebappLaunchSettings;

/** Match app names and control browser windows without retaining session state. */
class WebappLauncher {
  /** Run a bounded command without a shell or terminal, retaining diagnostics for the caller. */
  private async _runCommand({
    context,
    args,
    input,
  }: {
    context: WebappContext;
    args: string[];
    input?: string;
  }) {
    const child = Bun.spawn(args, {
      env: context.env,
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  }

  /**
   * Select the highest-ranked fuzzy name without showing an interactive picker.
   * The caller supplies sorted records for stable tie ordering and handles exact matches first.
   * Require fzf only when candidates exist; report no match without opening any app.
   */
  async matchName({
    context,
    query,
    apps,
  }: {
    context: WebappContext;
    query: string;
    apps: WebappRecord[];
  }) {
    if (!apps.length) throw new ApiError("INVALID_ARGUMENT", `No web app matches: ${query}`);
    const executable = Bun.which("fzf", { PATH: context.env.PATH ?? "" });
    if (!executable)
      throw new ApiError("INVALID_ENVIRONMENT", "Install fzf to launch web apps by a fuzzy name");
    // User fzf bindings and defaults must not change this noninteractive API operation.
    const env = { ...context.env };
    delete env.FZF_DEFAULT_OPTS;
    delete env.FZF_DEFAULT_OPTS_FILE;
    delete env.FZF_DEFAULT_COMMAND;
    const result = await this._runCommand({
      context: { ...context, env },
      args: [executable, `--filter=${query}`, "--no-extended", "--ignore-case", "--tiebreak=length,index"],
      input: apps.map((app) => app.name).join("\n") + "\n",
    });
    if (result.exitCode === 1)
      throw new ApiError("INVALID_ARGUMENT", `No web app matches: ${query}`);
    if (result.exitCode !== 0)
      throw new ApiError("COMMAND_FAILED", `Web app name matching failed: ${result.stderr || result.stdout}`);
    const selectedName = result.stdout.split("\n")[0];
    const selectedApp = apps.find((app) => app.name === selectedName);
    if (!selectedApp) throw new ApiError("COMMAND_FAILED", "fzf returned an unknown web app name");
    return selectedApp;
  }

  /**
   * Focus the most recently used mapped window with this app's exact generated class.
   * Return undefined outside Hyprland or when no window matches. Session errors fail
   * the request instead of opening a duplicate because the window state is unknown.
   */
  private async _focusExistingWindow({ context, app }: { context: WebappContext; app: WebappRecord }) {
    if (!context.env.HYPRLAND_INSTANCE_SIGNATURE) return;
    const executable = Bun.which("hyprctl", { PATH: context.env.PATH ?? "" });
    if (!executable)
      throw new ApiError("INVALID_ENVIRONMENT", "Hyprctl is required to focus an existing web app");
    const result = await this._runCommand({ context, args: [executable, "-j", "clients"] });
    if (result.exitCode !== 0)
      throw new ApiError("COMMAND_FAILED", `Cannot read app windows: ${result.stderr || result.stdout}`);
    let windows: ReturnType<typeof webappWindowsSchema.parse>;
    try {
      windows = webappWindowsSchema.parse(JSON.parse(result.stdout));
    } catch {
      throw new ApiError("COMMAND_FAILED", "Hyprctl returned invalid window data");
    }
    const matchingWindows = windows.filter((window) =>
      window.mapped !== false && (window.class === app.id || window.initialClass === app.id),
    );
    // Negative or missing history ranks mean the compositor has no focus ordering for that window.
    const focusRank = (rank: number | undefined) =>
      rank !== undefined && rank >= 0 ? rank : Infinity;
    matchingWindows.sort((left, right) =>
      focusRank(left.focusHistoryID) - focusRank(right.focusHistoryID),
    );
    const window = matchingWindows[0];
    if (!window) return;
    if (window.pid <= 0) throw new ApiError("COMMAND_FAILED", "App window has no valid process ID");
    // The address is schema-validated hex; use an exact selector instead of a class regex.
    const focused = await this._runCommand({
      context,
      args: [executable, "dispatch", `hl.dsp.focus({ window = "address:${window.address}" })`],
    });
    if (focused.exitCode !== 0 || focused.stdout !== "ok")
      throw new ApiError("COMMAND_FAILED", `Cannot focus app window: ${focused.stderr || focused.stdout}`);
    return { ...app, action: "focused" as const, pid: window.pid, windowAddress: window.address };
  }

  /**
   * Focus an existing Hyprland window, otherwise spawn Chromium in the configured Luna profile.
   * focusExisting=false skips window discovery and requests a new browser window.
   * Spawned processes are detached; an opened result does not wait for a window to appear.
   */
  async launch({
    context,
    app,
    focusExisting,
  }: {
    context: WebappContext;
    app: WebappRecord;
    focusExisting: boolean;
  }) {
    if (focusExisting) {
      const focused = await this._focusExistingWindow({ context, app });
      if (focused) return focused;
    }
    const browserExecutable = await webappContext.requireConfiguredBrowser(context);
    const browserProcess = Bun.spawn(
      [
        browserExecutable,
        `--user-data-dir=${context.profileRoot}`,
        "--profile-directory=Luna",
        `--app=${app.url}`,
        `--class=${app.id}`,
        "--no-first-run",
        "--no-default-browser-check",
        ...(focusExisting ? [] : ["--new-window"]),
      ],
      { env: context.env, stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true },
    );
    browserProcess.unref();
    return { ...app, action: "opened" as const, pid: browserProcess.pid };
  }
}

export const webappLauncher = new WebappLauncher();
