use super::{Login, config, paths, screens};
use crate::{
    Error, Result, config_io,
    install::{copy_tree, replace},
    io_error,
    theme::Themes,
};
use serde_json::{Value, json};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
};

impl Login {
    /// Snapshot the selected QML, resolved Luna theme values, and media.
    /// Publishes the entire output directory atomically. Existing output contents are
    /// replaced; overlaps with application sources, config, library, or assets fail first.
    /// This builds local files only and never changes the active display manager.
    pub fn build(&self, output: &Path) -> Result<PathBuf> {
        let _lock = config_io::lock(&self.paths.config_file)?;
        let config = self.get_config(None)?;
        let selected =
            self.screen_path(config["screen"]["name"].as_str().expect("validated name"))?;
        let greeter = fs::canonicalize(self.paths.app_dir.join("greeter"))
            .map_err(|error| io_error("locate login greeter", &self.paths.app_dir, error))?;
        if !greeter.is_dir()
            || !greeter.join("Main.qml").is_file()
            || !greeter.join("metadata.desktop").is_file()
        {
            return Err(Error::Message(
                "login greeter requires Main.qml and metadata.desktop".into(),
            ));
        }
        screens::validate_tree(&greeter, &greeter)?;
        let wallpaper = media(&config)?;
        let output = std::path::absolute(output)
            .map_err(|error| io_error("locate login output", output, error))?;
        let output_identity = paths::identity(&output)?;
        let mut protected = vec![
            paths::identity(&self.paths.app_dir)?,
            paths::identity(&self.paths.config_file)?,
            paths::identity(&self.paths.screens_dir)?,
            selected.clone(),
        ];
        if let Some((path, _)) = &wallpaper {
            protected.push(path.clone());
        }
        if protected
            .iter()
            .any(|path| paths::overlaps(&output_identity, path))
        {
            return Err(Error::Message(
                "login output overlaps configuration, source files, screen library, or assets"
                    .into(),
            ));
        }
        let theme = Themes::from_env()?.get(None)?;
        let mut colors = theme["colors"].clone();
        let mut font_values = theme["fonts"].clone();
        config::merge(&mut colors, &config["colors"]);
        config::merge(&mut font_values, &config["fonts"]);
        let mut settings = json!({
            "screen": {"name": config["screen"]["name"]},
            "wallpaper": {
                "source": config["wallpaper"]["source"], "type": config["wallpaper"]["type"],
                "fit": config["wallpaper"]["fit"], "background_color": config["wallpaper"]["background_color"]
            },
            "colors": colors, "fonts": font_values, "appearance": theme["appearance"]
        });
        let staging =
            tempfile::tempdir().map_err(|error| io_error("stage login theme", &output, error))?;
        let staged = staging.path().join("theme");
        fs::create_dir(&staged).map_err(|error| io_error("stage login theme", &staged, error))?;
        copy_tree(&greeter, &staged, &greeter)?;
        fs::create_dir(staged.join("screen"))
            .map_err(|error| io_error("stage selected screen", &staged, error))?;
        copy_tree(&selected, &staged.join("screen"), &selected)?;
        if let Some((source, kind)) = wallpaper {
            let extension = source
                .extension()
                .and_then(|value| value.to_str())
                .filter(|value| {
                    value
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric())
                })
                .unwrap_or("media");
            let relative = format!("assets/wallpaper.{extension}");
            copy_asset(&source, &staged.join(&relative))?;
            settings["wallpaper"]["source"] = json!(relative);
            settings["wallpaper"]["type"] = json!(kind);
        }
        // Generated settings contain only snapshots and bundle-relative asset paths.
        let settings = format!(
            ".pragma library\nvar values = {};\n",
            serde_json::to_string_pretty(&settings)?
        );
        fs::write(staged.join("Settings.js"), settings)
            .map_err(|error| io_error("write login settings", &staged, error))?;
        readable_tree(&staged)?;
        replace(&staged, &output, &staged)?;
        Ok(output)
    }
}

fn media(config: &Value) -> Result<Option<(PathBuf, String)>> {
    let source = config["wallpaper"]["source"]
        .as_str()
        .expect("validated source");
    if source.is_empty() {
        return Ok(None);
    }
    let path = regular_file(Path::new(source), "login wallpaper")?;
    let kind = config["wallpaper"]["type"]
        .as_str()
        .expect("validated type");
    let kind = if kind == "auto" {
        let output = Command::new("file")
            .args(["--brief", "--mime-type", "--"])
            .arg(&path)
            .output()
            .map_err(|error| io_error("detect login wallpaper type", &path, error))?;
        if !output.status.success() {
            return Err(Error::Message(format!(
                "cannot detect login wallpaper type: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        let mime = String::from_utf8_lossy(&output.stdout);
        if mime.trim().starts_with("image/") {
            "image"
        } else if mime.trim().starts_with("video/") {
            "video"
        } else {
            return Err(Error::Message(format!(
                "unsupported login wallpaper type: {}",
                mime.trim()
            )));
        }
    } else {
        kind
    };
    Ok(Some((path, kind.to_owned())))
}

fn regular_file(path: &Path, description: &str) -> Result<PathBuf> {
    let resolved =
        fs::canonicalize(path).map_err(|error| io_error("locate login asset", path, error))?;
    if !resolved.is_file() {
        return Err(Error::Message(format!(
            "{description} must be a regular file: {}",
            path.display()
        )));
    }
    Ok(resolved)
}

fn copy_asset(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination.parent().expect("asset parent"))
        .map_err(|error| io_error("stage login assets", destination, error))?;
    fs::copy(source, destination).map_err(|error| io_error("copy login asset", source, error))?;
    Ok(())
}

// SDDM reads the exported files as its own user, including assets originally private in HOME.
fn readable_tree(path: &Path) -> Result<()> {
    let mode = if path.is_dir() { 0o755 } else { 0o644 };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|error| io_error("set login bundle permissions", path, error))?;
    if path.is_dir() {
        for entry in
            fs::read_dir(path).map_err(|error| io_error("read login bundle", path, error))?
        {
            let entry = entry.map_err(|error| io_error("read login bundle", path, error))?;
            readable_tree(&entry.path())?;
        }
    }
    Ok(())
}
