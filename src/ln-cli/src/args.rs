use std::path::PathBuf;

use clap::{ArgGroup, Args, Parser, Subcommand};

#[derive(Parser)]
#[command(name = "lnxt", version, about)]
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
    /// Install app configurations, preserving existing user files.
    Configure {
        /// Configure these apps; omit names to configure all apps.
        #[arg(value_name = "APP")]
        names: Vec<String>,
        /// Use this Luna Next checkout.
        #[arg(long, value_name = "PATH")]
        repo: Option<PathBuf>,
    },
    /// Install all packages and app configurations.
    Setup {
        /// Use this Luna Next checkout.
        #[arg(long, value_name = "PATH")]
        repo: Option<PathBuf>,
    },
    /// Manage wallpapers and their configuration.
    #[command(alias = "w")]
    Wallpaper {
        #[command(subcommand)]
        command: WallpaperCommand,
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
    #[arg(long)]
    pub(crate) pacman: bool,
    /// Use this Luna Next checkout.
    #[arg(long, value_name = "PATH")]
    pub(crate) repo: Option<PathBuf>,
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
    /// Apply saved configuration by restarting the renderer.
    Reload,
    /// Report whether the renderer is running.
    Status,
}
