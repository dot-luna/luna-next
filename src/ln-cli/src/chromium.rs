use luna_next::{Result, chromium::Chromium, install};
use serde_json::Value;

use crate::args::ChromiumCommand;

pub(crate) fn run(command: &ChromiumCommand) -> Result<Value> {
    match command {
        ChromiumCommand::CreateProfile { profile } => Ok(serde_json::to_value(
            Chromium::from_env()?.create_profile(profile.as_deref())?,
        )?),
        ChromiumCommand::Setup { profile, repo } => {
            let repository = install::find_repository(repo.as_deref())?;
            Ok(serde_json::to_value(install::setup_chromium(
                &repository,
                profile.as_deref(),
            )?)?)
        }
    }
}

pub(crate) fn print(command: &ChromiumCommand, value: &Value) {
    let path = match command {
        ChromiumCommand::CreateProfile { .. } => &value["directory"],
        ChromiumCommand::Setup { .. } => &value["profile"],
    };
    println!("Chromium profile: {}", path.as_str().unwrap_or_default());
    if matches!(command, ChromiumCommand::Setup { .. }) {
        println!("Finish the extension and theme confirmations in Chromium.");
    }
}
