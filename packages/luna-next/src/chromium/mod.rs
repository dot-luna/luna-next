//! Profile-scoped configuration and app windows for ungoogled Chromium.

mod app;
mod appearance;
mod browser;
mod extensions;
mod files;
mod installation;
mod launch;
mod paths;
mod profile;

pub use paths::Paths;
pub use profile::Profile;

pub(crate) use app::validate_url as app_url;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::{Error, Result, config_io, io_error, theme::Themes};

/// The exact profile and extension selection affected by a configuration run.
#[derive(Debug, Serialize)]
pub struct Configured {
    pub profile: PathBuf,
    pub profile_name: String,
    pub extensions: Vec<String>,
    pub installation_page: PathBuf,
    pub installation_requires_confirmation: bool,
}

/// The URL and exact profile used for an accepted browser launch or process handoff.
#[derive(Debug, Serialize)]
pub struct Launched {
    pub url: String,
    pub profile: PathBuf,
    pub profile_name: String,
}

/// Create the Git-named default profile, configure an exact profile, or launch an app window.
pub struct Chromium {
    paths: Paths,
}

#[derive(Deserialize)]
struct Settings {
    extensions: Vec<String>,
}

impl Chromium {
    /// Select XDG paths without creating a profile or changing browser configuration.
    pub fn from_env() -> Result<Self> {
        Self::new(Paths::from_env()?)
    }

    /// Use explicit managed-root and launch-entry paths. Existing links and overlaps are rejected.
    pub fn new(mut paths: Paths) -> Result<Self> {
        for path in [
            &mut paths.user_data_dir,
            &mut paths.launcher,
            &mut paths.desktop_file,
        ] {
            if path.as_os_str().is_empty() {
                return Err(Error::Message("Chromium paths must not be empty".into()));
            }
            *path = std::path::absolute(&*path)
                .map_err(|error| io_error("locate Chromium path", path, error))?;
            if path.parent().is_none() {
                return Err(Error::Message(
                    "Chromium paths cannot be the filesystem root".into(),
                ));
            }
            paths::check(path)?;
        }
        let destinations = [&paths.user_data_dir, &paths.launcher, &paths.desktop_file];
        for (index, left) in destinations.iter().enumerate() {
            if destinations[index + 1..]
                .iter()
                .any(|right| left.starts_with(right) || right.starts_with(left))
            {
                return Err(Error::Message(
                    "Chromium output paths must not overlap".into(),
                ));
            }
        }
        Ok(Self { paths })
    }

    /// Inspect only the stable Git-created profile; this never runs a browser or package manager.
    pub fn default_profile_exists(&self) -> Result<bool> {
        profile::Target::resolve(&self.paths, None)?.exists()
    }

    /// Create a missing profile using global Git user.name, without applying extensions or theme.
    /// With no override, a stable private data root and Luna launcher are created. An explicit
    /// directory creates only that profile. Existing profiles are returned without resetting them.
    pub fn create_profile(&self, directory: Option<&Path>) -> Result<Profile> {
        require_user()?;
        profile::create(&self.paths, directory)
    }

    /// Open an HTTP(S) URL in a visible Chromium app window using an existing profile.
    /// Omission selects the Git-created profile. Existing browser processes may handle the
    /// request; no idle root is required. Luna does not create or configure browser state.
    /// URLs containing credentials or control characters, missing profiles/providers, and
    /// immediate browser launch failures return errors. Later window failures are not observed.
    pub fn launch_app(&self, url: &str, directory: Option<&Path>) -> Result<Launched> {
        require_user()?;
        app::launch(&self.paths, url, directory)
    }

    /// Inspect an existing app profile and verify the ungoogled Chromium provider.
    /// Omission selects Luna's default profile. Active browser roots are allowed;
    /// this does not open a browser window or write browser state.
    pub fn app_profile(&self, directory: Option<&Path>) -> Result<Profile> {
        require_user()?;
        let target = profile::Target::resolve(&self.paths, directory)?;
        let preferences = target.read_existing()?;
        browser::locate()?;
        Ok(Profile {
            directory: target.directory,
            name: profile::name(&preferences, &target.basename),
            launcher: target.managed.then(|| self.paths.launcher.clone()),
        })
    }

    /// Apply configuration to the Git-created profile; missing profiles are an error.
    pub fn configure(&self, config_dir: &Path) -> Result<Configured> {
        self.configure_profile(config_dir, None)
    }

    /// Create a missing selected profile, then apply the app settings. A later configuration
    /// failure leaves the created profile available for retry; existing profiles are never reset.
    pub fn setup(&self, config_dir: &Path, directory: Option<&Path>) -> Result<Configured> {
        settings(config_dir)?;
        let target = profile::Target::resolve(&self.paths, directory)?;
        check_source(config_dir, &target.directory)?;
        self.create_profile(directory)?;
        let configured = self.configure_profile(config_dir, directory)?;
        self.open_installation(&configured)?;
        Ok(configured)
    }

    /// Apply only to the selected existing profile. Omission selects the Git-created profile.
    /// Other profiles are not configured and the desktop default browser is not changed.
    /// Downloads and source checks precede publication. Each file publishes atomically;
    /// late application or filesystem failures may leave a partially configured selected profile.
    pub fn configure_profile(
        &self,
        config_dir: &Path,
        directory: Option<&Path>,
    ) -> Result<Configured> {
        require_user()?;
        let settings = settings(config_dir)?;
        let target = profile::Target::resolve(&self.paths, directory)?;
        target.existing()?;
        paths::check(&target.directory.join("Luna Next"))?;
        let (binary, version) = browser::locate()?;
        let _lock = config_io::lock(&target.root)?;
        target.existing()?;
        let mut preferences = files::File::open(&target.preferences())?;
        let state = files::File::open(&target.root.join("Local State"))?;
        state.json()?;
        let mut values = preferences.json()?;
        let name = profile::name(&values, &target.basename);
        let theme = Themes::from_env()?.get(None)?;
        set_fonts(&mut values, &theme)?;
        check_source(config_dir, &target.directory)?;
        let stage = tempfile::tempdir()
            .map_err(|error| io_error("stage Chromium configuration", config_dir, error))?;
        let packages = stage.path().join("packages");
        fs::create_dir(&packages)
            .map_err(|error| io_error("stage Chromium extensions", &packages, error))?;
        let prepared = extensions::prepare(&settings.extensions, &version, &packages)?;
        let appearance = stage.path().join("appearance");
        appearance::prepare(&theme, &appearance)?;
        target.existing()?;
        preferences.check()?;
        state.check()?;
        let bundle = installation::prepare(
            &binary,
            &target.directory,
            &packages,
            &prepared,
            &appearance,
            stage.path(),
        )?;
        target.existing()?;
        preferences.check()?;
        state.check()?;
        preferences.stage(
            &serde_json::to_vec_pretty(&values)?,
            preferences.mode(0o600),
        )?;
        target.idle()?;
        state.check()?;
        let installed_bundle = target.directory.join("Luna Next");
        paths::check(&installed_bundle)?;
        crate::install::replace(&bundle, &installed_bundle, &bundle)?;
        target.idle()?;
        preferences.publish()?;
        Ok(Configured {
            profile: target.directory,
            profile_name: name,
            extensions: settings.extensions,
            installation_page: installed_bundle.join("install.html"),
            installation_requires_confirmation: true,
        })
    }

    /// Open the prepared local installer in exactly its selected profile.
    /// Chromium owns the confirmation dialogs and persistent extension installation.
    /// No temporary extension flags, remote debugging, or browser-wide policies are used.
    pub fn open_installation(&self, configured: &Configured) -> Result<()> {
        let target = profile::Target::resolve(&self.paths, Some(&configured.profile))?;
        let _lock = config_io::lock(&target.root)?;
        target.existing()?;
        paths::check(&configured.installation_page)?;
        if !configured.installation_page.is_file()
            || configured.installation_page != target.directory.join("Luna Next/install.html")
        {
            return Err(Error::Message(
                "The selected profile has no prepared installation page".into(),
            ));
        }
        let (binary, _) = browser::locate()?;
        let page = url::Url::from_file_path(&configured.installation_page).map_err(|_| {
            Error::Message("Cannot encode the Chromium installation page path".into())
        })?;
        let log_path = configured.installation_page.with_file_name("browser.log");
        paths::check(&log_path)?;
        use std::os::unix::fs::OpenOptionsExt;
        let log = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&log_path)
            .map_err(|error| io_error("open Chromium launch log", &log_path, error))?;
        let mut user_data_argument = std::ffi::OsString::from("--user-data-dir=");
        user_data_argument.push(&target.root);
        let mut child = std::process::Command::new(binary)
            .arg(user_data_argument)
            .arg(format!("--profile-directory={}", target.basename))
            .args([
                "--no-first-run",
                "--no-default-browser-check",
                "--extension-mime-request-handling=always-prompt-for-install",
            ])
            .arg(page.as_str())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            // Detached browser processes must not retain a caller's captured JSON/output pipes.
            .stderr(std::process::Stdio::from(log))
            .spawn()
            .map_err(|error| {
                io_error(
                    "open Chromium installation page",
                    &configured.installation_page,
                    error,
                )
            })?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            if let Some(status) = child.try_wait().map_err(|error| {
                io_error(
                    "check Chromium launch",
                    &configured.installation_page,
                    error,
                )
            })? {
                if !status.success() {
                    return Err(Error::Message(format!(
                        "Chromium could not open the installation page ({status}); see {}",
                        log_path.display()
                    )));
                }
                break;
            }
            if fs::symlink_metadata(target.root.join("SingletonLock")).is_ok()
                || std::time::Instant::now() >= deadline
            {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
}

fn check_source(config_dir: &Path, profile: &Path) -> Result<()> {
    let source = fs::canonicalize(config_dir)
        .map_err(|error| io_error("locate Chromium app settings", config_dir, error))?;
    if profile.starts_with(&source) || source.starts_with(profile) {
        return Err(Error::Message(
            "Chromium profile overlaps app settings".into(),
        ));
    }
    Ok(())
}

fn require_user() -> Result<()> {
    if unsafe { libc::geteuid() } == 0 {
        return Err(Error::Message(
            "Run luna as your normal user, without sudo.".into(),
        ));
    }
    Ok(())
}

fn settings(config_dir: &Path) -> Result<Settings> {
    let path = config_dir.join("settings.conf");
    if !path.is_file() {
        return Err(Error::Message(format!(
            "Missing Chromium settings: {}",
            path.display()
        )));
    }
    let value = luna_next_hocon::load(&path)?;
    let schema_path = config_dir.join("settings.schema.json");
    let schema: Value = serde_json::from_slice(
        &fs::read(&schema_path)
            .map_err(|error| io_error("read Chromium settings schema", &schema_path, error))?,
    )?;
    luna_next_hocon::validate_value(&value, &schema)?;
    Ok(serde_json::from_value(value)?)
}

fn object<'a>(parent: &'a mut Value, key: &str) -> Result<&'a mut Value> {
    if parent.get(key).is_none() {
        parent[key] = json!({});
    }
    if !parent[key].is_object() {
        return Err(Error::Message(format!(
            "Chromium preference '{key}' must be an object"
        )));
    }
    Ok(&mut parent[key])
}

fn set_fonts(values: &mut Value, theme: &Value) -> Result<()> {
    let fonts = object(object(object(values, "webkit")?, "webprefs")?, "fonts")?;
    for (family, role) in [
        ("standard", "ui"),
        ("sansserif", "ui"),
        ("serif", "ui"),
        ("fixed", "mono"),
    ] {
        object(fonts, family)?["Zyyy"] = theme["fonts"][role].clone();
    }
    Ok(())
}
