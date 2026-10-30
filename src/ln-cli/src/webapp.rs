use luna_next::{Result, chromium::Chromium};
use serde_json::Value;

use crate::args::WebappCommand;

pub(crate) fn run(command: &WebappCommand) -> Result<Value> {
    match command {
        WebappCommand::Launch { url, profile } => Ok(serde_json::to_value(
            Chromium::from_env()?.launch_app(url, profile.as_deref())?,
        )?),
    }
}

pub(crate) fn print(_command: &WebappCommand, value: &Value) {
    println!(
        "Opened web app: {}",
        value["url"].as_str().unwrap_or_default()
    );
}
