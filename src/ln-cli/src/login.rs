use std::env;

use luna_next::login::{Login, deploy_system};
use serde_json::{Value, json};

use crate::args::LoginCommand;

pub(crate) fn run(
    command: &LoginCommand,
    json_output: bool,
) -> Result<Value, Box<dyn std::error::Error>> {
    // The elevated helper must never resolve a user's config, theme, or app paths.
    if let LoginCommand::Deploy { bundle } = command {
        return Ok(json!(deploy_system(bundle)?));
    }
    if matches!(command, LoginCommand::Preview) && json_output {
        return Err("login preview opens a foreground window and does not return JSON".into());
    }
    let login = Login::from_env()?;
    Ok(match command {
        LoginCommand::Install {
            folder,
            name,
            force,
        } => json!(login.install(folder, name.as_deref(), *force)?),
        LoginCommand::List => serde_json::to_value(login.list()?)?,
        LoginCommand::Current => json!(login.current()?),
        LoginCommand::Set { name } => login.set(name)?,
        LoginCommand::Build { output } => json!(login.build(output)?),
        LoginCommand::Preview => {
            login.preview()?;
            Value::Null
        }
        LoginCommand::Activate => json!(login.activate(&env::current_exe()?)?),
        LoginCommand::GetConfig { key } => login.get_config(key.as_deref())?,
        LoginCommand::UpdateConfig { changes } => {
            login.update_config(serde_json::from_str(changes)?)?
        }
        LoginCommand::GetConfigFile => json!(login.config_file()),
        LoginCommand::Dir => json!(login.directory()),
        LoginCommand::Deploy { .. } => unreachable!(),
    })
}

pub(crate) fn print(command: &LoginCommand, value: &Value) {
    match command {
        LoginCommand::List => {
            for entry in value.as_array().into_iter().flatten() {
                let marker = if entry["current"] == true { "* " } else { "  " };
                println!("{marker}{}", entry["name"].as_str().unwrap_or_default());
            }
        }
        LoginCommand::Set { .. } => {
            println!(
                "Login screen: {}",
                value["screen"]["name"].as_str().unwrap_or_default()
            );
        }
        LoginCommand::UpdateConfig { .. } => println!("Login configuration updated."),
        LoginCommand::Activate => println!("Login screen installed for the next login."),
        LoginCommand::Preview => {}
        _ => match value {
            Value::Null => {}
            Value::String(text) => println!("{text}"),
            _ => println!(
                "{}",
                serde_json::to_string_pretty(value).expect("JSON value")
            ),
        },
    }
}
