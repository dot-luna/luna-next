mod args;
mod install;
mod keyring;
mod menu;
mod output;
mod polkit;
mod theme;
mod wallpaper;

use std::process::ExitCode;

use clap::{Parser, error::ErrorKind};

use args::{Cli, Command};

fn main() -> ExitCode {
    let args: Vec<_> = std::env::args_os().collect();
    // Parsing can fail before Cli exists; retain JSON error output for those failures too.
    let wants_json = args
        .iter()
        .take_while(|arg| *arg != "--")
        .any(|arg| arg == "--json");
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(error) => {
            if matches!(
                error.kind(),
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion
            ) {
                let _ = error.print();
                return ExitCode::SUCCESS;
            }
            if wants_json {
                output::report_error(&error.to_string(), true);
            } else {
                let _ = error.print();
            }
            return ExitCode::from(2);
        }
    };
    let result: Result<_, Box<dyn std::error::Error>> = match &cli.command {
        Command::Install(arguments) => install::run(arguments).map_err(Into::into),
        Command::Configure { names, repo } => {
            install::configure(repo.as_deref(), names).map_err(Into::into)
        }
        Command::Setup { repo } => install::setup(repo.as_deref()).map_err(Into::into),
        Command::Wallpaper { command } => wallpaper::run(command, cli.json),
        Command::Theme { command } => theme::run(command, cli.json),
        Command::Polkit { command } => polkit::run(command, cli.json),
        Command::Menu { command } => menu::run(command.as_ref(), cli.json),
        Command::Keyring { command } => keyring::run(command).map_err(Into::into),
    };
    match result {
        Ok(value) => {
            output::success(&cli.command, &value, cli.json);
            ExitCode::SUCCESS
        }
        Err(error) => {
            output::report_error(&error.to_string(), cli.json);
            ExitCode::FAILURE
        }
    }
}
