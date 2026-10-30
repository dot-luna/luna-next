use std::path::PathBuf;

use clap::{ArgGroup, Args, Parser, Subcommand};

#[derive(Parser)]
#[command(name = "luna", bin_name = "luna", version, about)]
pub(crate) struct Cli {
    /// Return a JSON response for applications.
    #[arg(long, global = true)]
    pub(crate) json: bool,
    #[command(subcommand)]
    pub(crate) command: Command,
}

#[derive(Subcommand)]
pub(crate) enum Command {
    /// Install package groups, named packages, or local applications.
    Install(InstallArgs),
    /// Replace exported app configuration files and folders.
    #[command(visible_alias = "conf")]
    Configure {
        /// Configure these apps; omit names to configure all apps.
        #[arg(value_name = "APP")]
        names: Vec<String>,
        /// Use this Luna Next checkout.
        #[arg(long, value_name = "PATH")]
        repo: Option<PathBuf>,
        /// Apply Chromium settings to this existing profile directory.
        #[arg(long, value_name = "PATH")]
        profile: Option<PathBuf>,
    },
    /// Install all packages and app configurations, then enable the keyring socket.
    Setup {
        /// Use this Luna Next checkout.
        #[arg(long, value_name = "PATH")]
        repo: Option<PathBuf>,
    },
    /// Manage wallpapers and their configuration.
    #[command(visible_alias = "w")]
    Wallpaper {
        #[command(subcommand)]
        command: WallpaperCommand,
    },
    /// Install, configure, and activate login screens for SDDM.
    Login {
        #[command(subcommand)]
        command: LoginCommand,
    },
    /// Create and configure ungoogled Chromium profiles.
    Chromium {
        #[command(subcommand)]
        command: ChromiumCommand,
    },
    /// Install or launch websites as Chromium app windows.
    Webapp {
        #[command(subcommand)]
        command: WebappCommand,
    },
    /// Manage desktop authentication prompts.
    Polkit {
        #[command(subcommand)]
        command: PolkitCommand,
    },
    /// Show the application launcher or manage its session service.
    Menu {
        #[command(subcommand)]
        command: Option<MenuCommand>,
    },
    /// Configure desktop secret storage.
    Keyring {
        #[command(subcommand)]
        command: KeyringCommand,
    },
    /// Manage shared themes and system appearance.
    Theme {
        #[command(subcommand)]
        command: ThemeCommand,
    },
}

#[derive(Subcommand)]
pub(crate) enum ChromiumCommand {
    /// Create a profile without applying Luna settings; defaults to the Git-named profile.
    CreateProfile {
        /// Create this profile directory instead of the default Luna profile.
        #[arg(long, value_name = "PATH")]
        profile: Option<PathBuf>,
    },
    /// Create a missing profile and apply the Chromium app settings.
    Setup {
        /// Use this profile directory instead of the default Luna profile.
        #[arg(long, value_name = "PATH")]
        profile: Option<PathBuf>,
        /// Use this Luna Next checkout.
        #[arg(long, value_name = "PATH")]
        repo: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
pub(crate) enum WebappCommand {
    /// Create a desktop launcher and download the site's icon.
    Install {
        /// Display name; prompted when omitted in an interactive terminal.
        #[arg(long)]
        name: Option<String>,
        /// HTTP(S) website URL; prompted when omitted in an interactive terminal.
        #[arg(long)]
        url: Option<String>,
        /// Use this existing profile directory instead of the default Luna profile.
        #[arg(long, value_name = "PATH")]
        profile: Option<PathBuf>,
        /// Download this icon instead of discovering one on the website.
        #[arg(long, value_name = "URL")]
        icon_url: Option<String>,
    },
    /// Open a website without browser tabs or an address bar, using a Luna profile.
    Launch {
        url: String,
        /// Use this existing profile directory instead of the default Luna profile.
        #[arg(long, value_name = "PATH")]
        profile: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
pub(crate) enum LoginCommand {
    /// Copy a Luna-compatible screen folder containing Screen.qml.
    Install {
        folder: PathBuf,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        force: bool,
    },
    /// List available screens and mark the saved selection.
    List,
    /// Print the saved screen name.
    Current,
    /// Save a screen selection; build or activate to export it.
    Set { name: String },
    /// Export the selected screen, settings, and assets as a standalone SDDM theme.
    Build { output: PathBuf },
    /// Preview the prepared screen in an SDDM test window.
    Preview,
    /// Prepare and install the screen for the next login; uses sudo.
    Activate,
    /// Read login configuration, optionally at a dot-separated key.
    GetConfig { key: Option<String> },
    /// Merge a JSON object into login configuration; activate to apply it.
    UpdateConfig { changes: String },
    /// Print the login configuration path.
    GetConfigFile,
    /// Print the installed screen library directory.
    Dir,
    // Privilege boundary: this helper accepts only a bundle, never destination overrides.
    #[command(hide = true)]
    Deploy { bundle: PathBuf },
}

#[derive(Subcommand)]
pub(crate) enum ThemeCommand {
    /// Validate and copy a folder containing theme.conf; import its wallpapers.
    Install {
        folder: PathBuf,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        force: bool,
    },
    /// List installed themes and mark the selected one.
    List,
    /// Print the selected theme name, if any.
    Current,
    /// Print the library directory or an installed theme's folder.
    Path { name: Option<String> },
    /// Resolve the selected theme, optionally at a dot-separated key.
    Get { key: Option<String> },
    /// Resolve an installed theme without selecting it.
    Inspect { name: String },
    /// Select a theme and apply its system light/dark preference.
    Set { name: String },
    /// Read or change system appearance without changing theme colors.
    Mode {
        #[arg(value_parser = ["dark", "light", "toggle"])]
        mode: Option<String>,
    },
    /// Toggle the system appearance preference.
    Toggle,
    /// Print the selection configuration path.
    GetConfigFile,
    /// Print native Hyprland appearance as a Lua table, or JSON with --json.
    Hyprland,
    /// Apply the current palette and fonts using an app's native configuration.
    Apply {
        #[arg(value_parser = ["t3code"])]
        app: String,
    },
    /// Remove installed copies, protecting the selected theme.
    Remove {
        #[arg(required = true, num_args = 1..)]
        names: Vec<String>,
        #[arg(long)]
        dry_run: bool,
        #[arg(short = 'y', long)]
        yes: bool,
    },
}

#[derive(Args)]
#[command(group(ArgGroup::new("source").args(["pacman", "aur", "mise", "git", "local"])))]
pub(crate) struct InstallArgs {
    /// Install named packages; use --local to select local application names.
    #[arg(value_name = "PACKAGE")]
    pub(crate) names: Vec<String>,
    /// Select the core package group.
    #[arg(long, conflicts_with_all = ["mise", "git", "local"])]
    pub(crate) core: bool,
    /// Select the main package group.
    #[arg(long, conflicts_with_all = ["mise", "git", "local"])]
    pub(crate) main: bool,
    /// Select the tools managed by mise.
    #[arg(long)]
    pub(crate) mise: bool,
    /// Select packages installed from Git repositories.
    #[arg(long)]
    pub(crate) git: bool,
    /// Select local applications from this checkout.
    #[arg(long, visible_alias = "apps")]
    pub(crate) local: bool,
    /// Select packages from the Arch User Repository.
    #[arg(long)]
    pub(crate) aur: bool,
    /// Select packages from the official Arch repositories.
    #[arg(long, visible_alias = "pac")]
    pub(crate) pacman: bool,
    /// Use this Luna Next checkout.
    #[arg(long, value_name = "PATH")]
    pub(crate) repo: Option<PathBuf>,
}

#[derive(Subcommand)]
pub(crate) enum KeyringCommand {
    /// Enable GNOME Keyring's user socket now and for future logins.
    Setup,
}

#[derive(Subcommand)]
pub(crate) enum PolkitCommand {
    /// Validate, enable session autostart, and start the agent; preserve a healthy instance.
    Start,
    /// Stop the agent for this session.
    Stop,
    /// Validate the app, then restart the agent and enable session autostart.
    Restart,
    /// Print running, unavailable, or stopped.
    Status,
    /// Run the agent in the foreground; used by the user service.
    Serve,
}

#[derive(Subcommand)]
pub(crate) enum MenuCommand {
    /// Validate, enable session startup, and start hidden; preserve a ready instance.
    Start,
    /// Stop the launcher service for this session.
    Stop,
    /// Validate, then replace the service with a hidden launcher.
    Restart,
    /// Print running or stopped, independent of window visibility.
    Status,
    /// Start the service if needed and show the launcher.
    Show,
    /// Hide the launcher without starting a stopped service.
    Hide,
    /// Start the service if needed and toggle launcher visibility.
    Toggle,
    /// Run the hidden launcher in the foreground; used by the user service.
    Serve,
}

#[derive(Subcommand)]
pub(crate) enum WallpaperCommand {
    /// Import media from files, directories, or HTTP(S) URLs.
    Add {
        #[arg(required = true, num_args = 1..)]
        targets: Vec<String>,
        #[arg(short, long)]
        recursive: bool,
        /// Replace existing library files.
        #[arg(long)]
        force: bool,
    },
    /// List library files and the current selection.
    List,
    /// Save a selection and reload the wallpaper renderer.
    Set { target: String },
    /// Select a random library wallpaper and reload the renderer.
    Random,
    /// Remove library files, protecting the current selection.
    Remove {
        #[arg(required = true, num_args = 1..)]
        names: Vec<String>,
        /// Show validated removal paths without deleting them.
        #[arg(long)]
        dry_run: bool,
        /// Confirm deletion without prompting.
        #[arg(short = 'y', long)]
        yes: bool,
    },
    /// Read resolved configuration, optionally at a dot-separated key.
    GetConfig { key: Option<String> },
    /// Merge a JSON object into the configuration and reload the renderer.
    UpdateConfig { changes: String },
    /// Print the user configuration path.
    GetConfigFile,
    /// Print the wallpaper library directory.
    Dir,
    /// Open the wallpaper library in the file manager.
    Open,
    /// Start the renderer, reusing an existing instance.
    Start,
    /// Stop the renderer and its media playback.
    Stop,
    /// Restart the renderer to read the latest configuration.
    Restart,
    /// Apply saved configuration without restarting the renderer.
    Reload,
    /// Report whether the renderer is running.
    Status,
}
