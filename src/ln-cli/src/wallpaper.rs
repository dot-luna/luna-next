use std::{
    error::Error,
    io::{self, IsTerminal, Write},
};

use luna_next::wallpaper::{AddOptions, Wallpaper};
use serde_json::{Value, json};

use crate::args::WallpaperCommand;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

pub(crate) fn run(command: &WallpaperCommand, json_output: bool) -> Result<Value> {
    let wallpaper = Wallpaper::from_env()?;
    Ok(match command {
        WallpaperCommand::Add {
            targets,
            recursive,
            force,
        } => serde_json::to_value(wallpaper.add(
            targets,
            &AddOptions {
                recursive: *recursive,
                force: *force,
            },
        )?)?,
        WallpaperCommand::List => serde_json::to_value(wallpaper.list()?)?,
        WallpaperCommand::Set { target } => wallpaper.set(target)?,
        WallpaperCommand::Random => wallpaper.random()?,
        WallpaperCommand::Remove {
            names,
            dry_run,
            yes,
        } => {
            let plan = wallpaper.removal_plan(names)?;
            if *dry_run {
                return Ok(serde_json::to_value(plan)?);
            }
            if !yes {
                if json_output || !io::stdin().is_terminal() {
                    return Err(
                        "removal requires --yes or --dry-run when not prompting in a terminal"
                            .into(),
                    );
                }
                for path in &plan {
                    eprintln!("{}", path.display());
                }
                eprint!("Remove {} wallpaper(s)? [y/N] ", plan.len());
                io::stderr().flush()?;
                let mut answer = String::new();
                io::stdin().read_line(&mut answer)?;
                if !matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes") {
                    return Ok(json!([]));
                }
            }
            serde_json::to_value(wallpaper.remove(names)?)?
        }
        WallpaperCommand::GetConfig { key } => wallpaper.get_config(key.as_deref())?,
        WallpaperCommand::UpdateConfig { changes } => {
            wallpaper.update_config(serde_json::from_str(changes)?)?
        }
        WallpaperCommand::GetConfigFile => json!(wallpaper.config_file()),
        WallpaperCommand::Dir => json!(wallpaper.directory()),
        WallpaperCommand::Open => {
            wallpaper.open_directory()?;
            Value::Null
        }
        WallpaperCommand::Start => serde_json::to_value(wallpaper.start()?)?,
        WallpaperCommand::Stop => serde_json::to_value(wallpaper.stop()?)?,
        WallpaperCommand::Restart => serde_json::to_value(wallpaper.restart()?)?,
        WallpaperCommand::Reload => serde_json::to_value(wallpaper.reload()?)?,
        WallpaperCommand::Status => serde_json::to_value(wallpaper.status()?)?,
    })
}
