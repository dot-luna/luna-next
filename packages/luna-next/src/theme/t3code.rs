//! Publish Luna's resolved values using T3's supported environment-theme and client settings.

use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};

use super::Themes;
use crate::{Error, Result, config_io, io_error};

// Native T3 role -> shared semantic color. Keep readable text separate from decoration.
const COLORS: &[(&str, &str)] = &[
    ("canvas", "background"),
    ("chrome", "dark_background"),
    ("toolbar", "dark_background"),
    ("toolbarForeground", "foreground"),
    ("toolbarBorder", "muted"),
    ("toolbarControl", "lighter_background"),
    ("toolbarControlForeground", "foreground"),
    ("toolbarControlHover", "selection"),
    ("surface", "background"),
    ("surfaceRaised", "lighter_background"),
    ("surfaceOverlay", "lighter_background"),
    ("text", "foreground"),
    ("textMuted", "light_foreground"),
    ("border", "muted"),
    ("input", "muted"),
    ("focus", "accent"),
    ("accent", "accent"),
    ("accentForeground", "accent_foreground"),
    ("secondary", "secondary_accent"),
    ("secondaryForeground", "secondary_accent_foreground"),
    ("muted", "muted"),
    ("mutedForeground", "bright_foreground"),
    ("placeholder", "light_foreground"),
    ("secondaryLabel", "light_foreground"),
    ("iconMuted", "light_foreground"),
    ("error", "error"),
    ("errorForeground", "error"),
    ("errorSurface", "background"),
    ("warning", "warning"),
    ("warningForeground", "warning"),
    ("warningSurface", "background"),
    ("update", "info"),
    ("updateForeground", "info"),
    ("updateSurface", "background"),
    ("accentSurface", "selection"),
    ("accentSurfaceForeground", "selection_foreground"),
    ("messageSurface", "lighter_background"),
    ("messageForeground", "foreground"),
    ("messageAction", "accent"),
    ("messageActionForeground", "accent_foreground"),
    ("messageActionHover", "accent"),
    ("codeBackground", "darker_background"),
    ("codeForeground", "foreground"),
    ("searchMatchBackground", "selection"),
    ("searchMatchForeground", "selection_foreground"),
    ("searchMatchActiveBackground", "accent"),
    ("searchMatchActiveForeground", "accent_foreground"),
    ("sidebar", "dark_background"),
    ("sidebarForeground", "foreground"),
    ("sidebarMutedForeground", "light_foreground"),
    ("sidebarControlSurface", "lighter_background"),
    ("sidebarRowHover", "lighter_background"),
    ("sidebarRowActive", "selection"),
    ("sidebarRowSelected", "selection"),
    ("sidebarBorder", "muted"),
    ("terminalBackground", "darker_background"),
    ("terminalForeground", "foreground"),
    ("terminalCursor", "accent"),
    ("terminalSelection", "selection"),
    ("terminalScrollbar", "muted"),
    ("terminalScrollbarHover", "light_foreground"),
];

impl Themes {
    /// Apply the selected theme to an explicit T3 userdata directory using native JSON
    /// files. Other preferences are retained. T3 adopts palette updates through its own
    /// environment-theme support; font changes need a desktop restart.
    /// All documents are parsed/staged before publication. A late write failure can leave
    /// a partial application; detected external edits are never overwritten.
    pub fn apply_t3code(&self, state_dir: &Path) -> Result<Value> {
        if state_dir.as_os_str().is_empty() {
            return Err(Error::Message("T3 userdata path must not be empty".into()));
        }
        let _lock = config_io::lock(&self.paths.config_file)?;
        let theme = self.get(None)?;
        let state_dir = std::path::absolute(state_dir)
            .map_err(|error| io_error("locate T3 settings", state_dir, error))?;
        let palette_path = state_dir.join("themes/luna-next.json");
        let client_path = state_dir.join("client-settings.json");
        let server_path = state_dir.join("settings.json");
        // T3's environment-theme reader rejects links at the published file itself.
        if fs::symlink_metadata(&palette_path).is_ok_and(|metadata| metadata.is_symlink()) {
            return Err(Error::Message(
                "T3 published theme files cannot be symlinks".into(),
            ));
        }
        let colors = COLORS
            .iter()
            .map(|(native, shared)| ((*native).to_owned(), theme["colors"][shared].clone()))
            .collect::<serde_json::Map<_, _>>();
        let palette = json!({
            "version": 1, "name": "Luna Next", "appearance": theme["colors"]["mode"],
            "canvas": theme["colors"]["background"], "accent": theme["colors"]["accent"], "colors": colors
        });
        let mut palette_document = Document::open(&palette_path, json!({}))?;
        palette_document.value = palette;
        let mut palette = palette_document;
        let mut client = Document::open(&client_path, json!({}))?;
        let mut server = Document::open(&server_path, json!({}))?;
        if client.value.get("settings").is_some() {
            return Err(Error::Message(
                "T3 client-settings.json must use the current flat JSON format".into(),
            ));
        }
        for (key, role) in [
            ("fontFamilySans", "ui"),
            ("fontFamilyComposer", "ui"),
            ("fontFamilyCode", "mono"),
            ("fontFamilyTerminal", "mono"),
        ] {
            client.value[key] = theme["fonts"][role].clone();
        }
        client.value["mathRenderingEnabled"] = json!(true);
        if palette.previous_value()? != palette.value || server.value["defaultTheme"] != "luna-next"
        {
            // T3 treats each changed generation as an explicit environment-theme selection.
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|error| Error::Message(error.to_string()))?;
            server.value["defaultTheme"] = json!("luna-next");
            server.value["defaultThemeSetAt"] = json!(now.as_nanos().to_string());
        }
        for document in [&mut palette, &mut client, &mut server] {
            document.stage()?;
        }
        // Validate every original before the first write, then recheck each at publication.
        for document in [&palette, &client, &server] {
            document.check()?;
        }
        for document in [&mut palette, &mut client, &mut server] {
            document.publish()?;
        }
        Ok(
            json!({"theme": palette_path, "client_settings": client_path, "server_settings": server_path}),
        )
    }
}

struct Document {
    path: PathBuf,
    original: Option<String>,
    value: Value,
    staged: Option<tempfile::NamedTempFile>,
}

impl Document {
    fn open(path: &Path, initial: Value) -> Result<Self> {
        let path = match fs::canonicalize(path) {
            Ok(path) => path,
            Err(error) if error.kind() == io::ErrorKind::NotFound => path.to_owned(),
            Err(error) => return Err(io_error("locate T3 configuration", path, error)),
        };
        let original = read(&path)?;
        let value = match original.as_deref() {
            Some(source) => serde_json::from_str(source)?,
            None => initial,
        };
        if !value.is_object() {
            return Err(Error::Message(format!(
                "T3 configuration must be a JSON object: {}",
                path.display()
            )));
        }
        Ok(Self {
            path,
            original,
            value,
            staged: None,
        })
    }
    fn previous_value(&self) -> Result<Value> {
        Ok(match self.original.as_deref() {
            Some(source) => serde_json::from_str(source)?,
            None => Value::Null,
        })
    }
    fn stage(&mut self) -> Result<()> {
        if self.previous_value()? == self.value {
            return Ok(());
        }
        let parent = self.path.parent().unwrap();
        fs::create_dir_all(parent)
            .map_err(|error| io_error("create T3 settings directory", parent, error))?;
        let mut staged = tempfile::NamedTempFile::new_in(parent)
            .map_err(|error| io_error("stage T3 configuration", &self.path, error))?;
        writeln!(staged, "{}", serde_json::to_string_pretty(&self.value)?)
            .map_err(|error| io_error("write T3 configuration", &self.path, error))?;
        if self.original.is_some() {
            let mode = fs::metadata(&self.path)
                .map_err(|error| io_error("read T3 permissions", &self.path, error))?
                .permissions();
            staged
                .as_file()
                .set_permissions(mode)
                .map_err(|error| io_error("preserve T3 permissions", &self.path, error))?;
        }
        staged
            .as_file()
            .sync_all()
            .map_err(|error| io_error("sync T3 configuration", &self.path, error))?;
        self.staged = Some(staged);
        Ok(())
    }
    fn check(&self) -> Result<()> {
        if read(&self.path)? != self.original {
            return Err(Error::Message(format!(
                "T3 configuration changed externally: {}",
                self.path.display()
            )));
        }
        Ok(())
    }
    fn publish(&mut self) -> Result<()> {
        self.check()?;
        if let Some(staged) = self.staged.take() {
            staged
                .persist(&self.path)
                .map_err(|error| io_error("publish T3 configuration", &self.path, error.error))?;
            fs::File::open(self.path.parent().unwrap())
                .and_then(|file| file.sync_all())
                .map_err(|error| io_error("sync T3 configuration directory", &self.path, error))?;
        }
        Ok(())
    }
}

fn read(path: &Path) -> Result<Option<String>> {
    match fs::metadata(path) {
        Ok(metadata) if !metadata.is_file() => {
            return Err(Error::Message(format!(
                "T3 configuration must be a regular file: {}",
                path.display()
            )));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error("inspect T3 configuration", path, error)),
    }
    match fs::read_to_string(path) {
        Ok(source) => Ok(Some(source)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error("read T3 configuration", path, error)),
    }
}

#[cfg(test)]
#[path = "../../tests/unit/t3code_theme.rs"]
mod tests;
