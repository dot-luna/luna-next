use serde_json::{Value, json};

use crate::args::WallpaperCommand;

pub(crate) fn success(command: &WallpaperCommand, value: &Value, json_output: bool) {
    if json_output {
        println!("{}", json!({ "ok": true, "result": value }));
    } else {
        print_human(command, value);
    }
}

fn print_human(command: &WallpaperCommand, value: &Value) {
    match command {
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
