use std::{
    error::Error,
    io::{self, IsTerminal, Write},
};

use luna_next::theme::Themes;
use serde_json::{Value, json};

use crate::args::ThemeCommand;

pub(crate) fn run(command: &ThemeCommand, json_output: bool) -> Result<Value, Box<dyn Error>> {
    let themes = Themes::from_env()?;
    Ok(match command {
        ThemeCommand::Install {
            folder,
            name,
            force,
        } => json!(themes.install(folder, name.as_deref(), *force)?),
        ThemeCommand::List => serde_json::to_value(themes.list()?)?,
        ThemeCommand::Current => json!(themes.current()?),
        ThemeCommand::Path { name } => match name {
            Some(name) => json!(themes.path(name)?),
            None => json!(themes.directory()),
        },
        ThemeCommand::Get { key } => themes.get(key.as_deref())?,
        ThemeCommand::Inspect { name } => themes.inspect(name)?,
        ThemeCommand::Set { name } => themes.set(name)?,
        ThemeCommand::Mode { mode } => json!(match mode.as_deref() {
            None => themes.mode()?,
            Some("toggle") => themes.toggle()?,
            Some(mode) => themes.set_mode(mode)?,
        }),
        ThemeCommand::Toggle => json!(themes.toggle()?),
        ThemeCommand::GetConfigFile => json!(themes.config_file()),
        ThemeCommand::Hyprland => themes.hyprland()?,
        ThemeCommand::Remove {
            names,
            dry_run,
            yes,
        } => {
            let paths = themes.removal_plan(names)?;
            if *dry_run {
                return Ok(json!(paths));
            }
            if !yes && !paths.is_empty() {
                if json_output || !io::stdin().is_terminal() {
                    return Err(
                        "removal requires --yes or --dry-run when not prompting in a terminal"
                            .into(),
                    );
                }
                for path in &paths {
                    eprintln!("{}", path.display());
                }
                eprint!("Remove {} theme(s)? [y/N] ", paths.len());
                io::stderr().flush()?;
                let mut answer = String::new();
                io::stdin().read_line(&mut answer)?;
                if !matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes") {
                    return Ok(json!([]));
                }
            }
            json!(themes.remove(names)?)
        }
    })
}

pub(crate) fn print(command: &ThemeCommand, value: &Value) {
    match command {
        ThemeCommand::List => {
            for entry in value.as_array().into_iter().flatten() {
                println!(
                    "{}{}",
                    if entry["current"] == true { "* " } else { "  " },
                    entry["name"].as_str().unwrap_or_default()
                );
            }
        }
        ThemeCommand::Set { .. } => {
            println!("Theme: {}", value["name"].as_str().unwrap_or_default())
        }
        ThemeCommand::Hyprland => println!("return {}", lua(value)),
        ThemeCommand::Remove { .. } => {
            for path in value.as_array().into_iter().flatten() {
                println!("{}", path.as_str().unwrap_or_default());
            }
        }
        _ => match value {
            Value::Null => {}
            Value::String(value) => println!("{value}"),
            _ => println!(
                "{}",
                serde_json::to_string_pretty(value).expect("JSON value")
            ),
        },
    }
}

// The adapter contains only schema-validated numbers, booleans, ASCII keys and hex colors.
fn lua(value: &Value) -> String {
    match value {
        Value::Object(fields) => format!(
            "{{{}}}",
            fields
                .iter()
                .map(|(key, value)| format!(
                    "[{}]={}",
                    serde_json::to_string(key).unwrap(),
                    lua(value)
                ))
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::String(_) | Value::Bool(_) | Value::Number(_) => value.to_string(),
        _ => unreachable!("native Hyprland adapter contains only objects and scalar settings"),
    }
}
