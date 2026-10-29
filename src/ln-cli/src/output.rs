use serde_json::{Value, json};

use crate::args::{Command, WallpaperCommand};

// JSON retains complete API results; human output summarizes mutations without dumping config.
pub(crate) fn success(command: &Command, value: &Value, json_output: bool) {
    if json_output {
        println!("{}", json!({ "ok": true, "result": value }));
    } else {
        match command {
            Command::Install(_) | Command::Configure { .. } | Command::Setup { .. } => {
                print_install(value)
            }
            Command::Wallpaper { command } => print_human(command, value),
        }
    }
}

fn print_install(value: &Value) {
    for (field, action) in [("installed", "Installed"), ("skipped", "Skipped")] {
        for name in value[field].as_array().into_iter().flatten() {
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
        eprintln!("lnxt: {error}");
    }
}
