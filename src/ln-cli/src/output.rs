use serde_json::{Value, json};

use crate::args::{Command, WallpaperCommand};

// JSON retains complete API results; human output summarizes mutations without dumping config.
pub(crate) fn success(command: &Command, value: &Value, json_output: bool) {
    if json_output {
        println!("{}", json!({ "ok": true, "result": value }));
    } else {
        match command {
            Command::Install(_) | Command::Configure { .. } | Command::Setup { .. } => {
                let opened =
                    matches!(command, Command::Configure { names, .. } if !names.is_empty());
                print_install(value, opened)
            }
            Command::Wallpaper { command } => print_human(command, value),
            Command::Theme { command } => crate::theme::print(command, value),
            Command::Login { command } => crate::login::print(command, value),
            Command::Chromium { command } => crate::chromium::print(command, value),
            Command::Polkit { .. } | Command::Menu { .. } | Command::Keyring { .. } => {
                println!("{}", value.as_str().unwrap_or_default())
            }
        }
    }
}

fn print_install(value: &Value, opened: bool) {
    for (field, action) in [("installed", "Installed"), ("skipped", "Skipped")] {
        for name in value[field].as_array().into_iter().flatten() {
            if field == "installed" && name == "chromium" {
                if opened {
                    println!(
                        "Prepared Chromium settings; finish the confirmations in the opened profile."
                    );
                } else {
                    println!(
                        "Prepared Chromium settings; run luna chromium setup to finish installation."
                    );
                }
                continue;
            }
            println!("{action}: {}", name.as_str().unwrap_or_default());
        }
    }
}

fn print_human(command: &WallpaperCommand, value: &Value) {
    match command {
        WallpaperCommand::Set { .. } | WallpaperCommand::Random => {
            println!(
                "Wallpaper: {}",
                value["wallpaper"]["source"].as_str().unwrap_or_default()
            );
        }
        WallpaperCommand::UpdateConfig { .. } => println!("Wallpaper configuration updated."),
        WallpaperCommand::List => {
            for entry in value.as_array().into_iter().flatten() {
                let marker = if entry["current"] == true { "* " } else { "  " };
                println!("{marker}{}", entry["path"].as_str().unwrap_or_default());
            }
        }
        WallpaperCommand::Add { .. } => {
            for entry in value.as_array().into_iter().flatten() {
                let action = if entry["added"] == true {
                    "Added"
                } else {
                    "Skipped"
                };
                println!("{action}: {}", entry["path"].as_str().unwrap_or_default());
            }
        }
        WallpaperCommand::Remove { .. } => {
            for path in value.as_array().into_iter().flatten() {
                println!("{}", path.as_str().unwrap_or_default());
            }
        }
        _ => match value {
            Value::Null => {}
            Value::String(text) => println!("{text}"),
            Value::Array(_) | Value::Object(_) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(value).expect("JSON value")
                );
            }
            _ => println!("{value}"),
        },
    }
}

pub(crate) fn report_error(error: &str, json_output: bool) {
    if json_output {
        println!("{}", json!({ "ok": false, "error": error }));
    } else {
        eprintln!("luna: {error}");
    }
}
