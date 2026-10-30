use std::io::{self, IsTerminal, Write};

use luna_next::{Error, Result, chromium::Chromium, webapp::Webapps};
use serde_json::Value;

use crate::args::WebappCommand;

pub(crate) fn run(command: &WebappCommand, json_output: bool) -> Result<Value> {
    match command {
        WebappCommand::Install {
            name,
            url,
            profile,
            icon_url,
        } => {
            let (name, url) = installation_input(name.as_deref(), url.as_deref(), json_output)?;
            let launcher = std::env::current_exe().map_err(|error| {
                Error::Message(format!("Cannot locate the Luna executable: {error}"))
            })?;
            Ok(serde_json::to_value(
                Webapps::from_env(&launcher)?.install(
                    &name,
                    &url,
                    profile.as_deref(),
                    icon_url.as_deref(),
                )?,
            )?)
        }
        WebappCommand::Launch { url, profile } => Ok(serde_json::to_value(
            Chromium::from_env()?.launch_app(url, profile.as_deref())?,
        )?),
    }
}

pub(crate) fn print(command: &WebappCommand, value: &Value) {
    match command {
        WebappCommand::Install { .. } => {
            println!(
                "Installed web app: {}",
                value["name"].as_str().unwrap_or_default()
            );
            println!(
                "Desktop entry: {}",
                value["desktop_file"].as_str().unwrap_or_default()
            );
        }
        WebappCommand::Launch { .. } => {
            println!(
                "Opened web app: {}",
                value["url"].as_str().unwrap_or_default()
            );
        }
    }
}

fn installation_input(
    name: Option<&str>,
    url: Option<&str>,
    json: bool,
) -> Result<(String, String)> {
    if (name.is_none() || url.is_none()) && (json || !io::stdin().is_terminal()) {
        return Err(Error::Message(
            "Web app installation requires --name and --url; omit them only in an interactive terminal".into(),
        ));
    }
    let name = match name {
        Some(value) => value.to_owned(),
        None => prompt("Name: ")?,
    };
    let url = match url {
        Some(value) => value.to_owned(),
        None => prompt("URL: ")?,
    };
    Ok((name, url))
}

fn prompt(label: &str) -> Result<String> {
    eprint!("{label}");
    io::stderr()
        .flush()
        .map_err(|error| Error::Message(format!("Cannot show prompt: {error}")))?;
    let mut value = String::new();
    if io::stdin()
        .read_line(&mut value)
        .map_err(|error| Error::Message(format!("Cannot read input: {error}")))?
        == 0
    {
        return Err(Error::Message(
            "Web app installation cancelled: input ended".into(),
        ));
    }
    Ok(value.trim_end_matches(['\r', '\n']).to_owned())
}
