mod args;
mod output;
mod wallpaper;

use std::process::ExitCode;

use clap::{Parser, error::ErrorKind};

use args::{Cli, Command};

fn main() -> ExitCode {
    let args: Vec<_> = std::env::args_os().collect();
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
    let Command::Wallpaper { command } = &cli.command;
    match wallpaper::run(command, cli.json) {
        Ok(value) => {
            output::success(command, &value, cli.json);
            ExitCode::SUCCESS
        }
        Err(error) => {
            output::report_error(&error.to_string(), cli.json);
            ExitCode::FAILURE
        }
    }
}
