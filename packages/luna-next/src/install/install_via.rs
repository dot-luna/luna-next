use std::{
    collections::HashSet,
    env, fs, io,
    os::unix::fs::symlink,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};

use serde::{Deserialize, Serialize};

use super::git_versions;
use crate::{Error, Result, io_error};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    #[default]
    Pacman,
    Aur,
    Mise,
    Git,
    Local,
}

/// Names reported after successful operations, not a record of package-manager changes.
/// A tool's `--needed` option can leave an already-installed package untouched.
#[derive(Debug, Default, Serialize)]
pub struct Report {
    pub installed: Vec<String>,
    pub skipped: Vec<String>,
}

/// Installation recipe. Source-specific requirements are checked by its installer.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Package {
    pub name: String,
    pub source: Source,
    /// Canonical catalog checkout, populated by [`super::get_packages`], never from a manifest.
    /// Commands receive this as `LUNA_NEXT_ROOT`; `None` preserves the inherited variable.
    #[serde(skip)]
    pub repository: Option<PathBuf>,
    /// Git remote URL or local source directory; unused by package-manager sources.
    pub url: Option<String>,
    /// Git branch/tag (`latest` selects the highest eligible remote tag), or mise version.
    /// Unspecified Git versions use the remote's default branch on the first clone.
    pub version: Option<String>,
    /// Allow prerelease version tags for Git `latest`; pinned refs are unaffected.
    #[serde(default)]
    pub git_include_prereleases: bool,
    /// Optional Git tag-name glob for `latest`, such as `v*` or `release/*`.
    pub git_release_tag_pattern: Option<String>,
    /// Local link path relative to `~/.local`; defaults to `src/<name>`.
    pub destination: Option<PathBuf>,
    /// Argument arrays run in the Git checkout or local link, without an implicit shell.
    /// Git recipes receive the selected ref in `LUNA_PACKAGE_VERSION`, unset for default-branch
    /// installs without a selected tag. The `refs/tags/` prefix is stripped; a leading `v` remains.
    #[serde(default)]
    pub command: Vec<Vec<String>>,
}

/// Dispatch to `source`; the source argument selects the installer, not each recipe's field.
/// This installs packages only. Call [`super::configure_installed_apps`] separately for configs.
pub fn install(source: Source, packages: &[Package]) -> Result<Report> {
    match source {
        Source::Pacman => install_via_pacman(packages),
        Source::Aur => install_via_aur(packages),
        Source::Mise => install_via_mise(packages),
        Source::Git => install_via_git(packages),
        Source::Local => install_via_local(packages),
    }
}

/// Run `sudo pacman -S --needed --noconfirm` for nonempty, unversioned package names.
pub fn install_via_pacman(packages: &[Package]) -> Result<Report> {
    run(
        Source::Pacman,
        packages,
        Command::new("sudo").args(["pacman", "-S", "--needed", "--noconfirm", "--"]),
    )
}

/// Run an existing `yay` with `--aur --needed --noconfirm` for nonempty, unversioned names.
pub fn install_via_aur(packages: &[Package]) -> Result<Report> {
    run(
        Source::Aur,
        packages,
        Command::new("yay").args(["-S", "--aur", "--needed", "--noconfirm", "--"]),
    )
}

/// Run `mise install --yes` for selected tools; an empty slice uses mise's own configuration.
pub fn install_via_mise(packages: &[Package]) -> Result<Report> {
    run(
        Source::Mise,
        packages,
        Command::new("mise").args(["install", "--yes", "--"]),
    )
}

/// Clone shallow checkouts under `~/.local/src/<name>` and run each recipe's commands.
/// Existing branches pull with fast-forward only; selected refs fetch at depth one.
/// Dirty tracked files, mismatched origins, and unreferenced detached commits are rejected.
/// `latest` uses Git version sorting with optional tag-pattern and prerelease filters.
/// Without a pattern, untagged remotes use the default branch.
pub fn install_via_git(packages: &[Package]) -> Result<Report> {
    let mut names = HashSet::new();
    for package in packages {
        identifier(&package.name)?;
        if !names.insert(&package.name) {
            return Err(Error::Message(format!(
                "Duplicate Git package '{}'",
                package.name
            )));
        }
        git_url(package)?;
        if package.command.is_empty() {
            return Err(Error::Message(format!(
                "Missing command for Git package '{}'",
                package.name
            )));
        }
        validate_commands(package)?;
        if let Some(pattern) = &package.git_release_tag_pattern
            && (pattern.is_empty() || pattern.contains('\0'))
        {
            return Err(Error::Message(format!(
                "Invalid Git release tag pattern for '{}'",
                package.name
            )));
        }
        if let Some(version) = &package.version {
            query(Command::new("git").args(["check-ref-format", "--allow-onelevel", version]))?;
        }
    }
    if packages.is_empty() {
        return Ok(Report::default());
    }
    require_user()?;
    let sources = local_root()?.join("src");
    fs::create_dir_all(&sources)
        .map_err(|error| io_error("create source directory", &sources, error))?;
    let mut report = Report::default();
    for package in packages {
        let url = git_url(package)?;
        let directory = sources.join(&package.name);
        let existing = match fs::symlink_metadata(&directory) {
            Ok(metadata) if metadata.is_dir() && !metadata.is_symlink() => true,
            Ok(_) => {
                return Err(Error::Message(format!(
                    "Git checkout path already exists: {}",
                    directory.display()
                )));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => false,
            Err(error) => return Err(io_error("inspect Git checkout", &directory, error)),
        };
        if existing {
            let root = query(git(&directory).args(["rev-parse", "--show-toplevel"]))?;
            let actual = fs::canonicalize(&directory)
                .map_err(|error| io_error("locate Git checkout", &directory, error))?;
            if Path::new(root.trim()) != actual {
                return Err(Error::Message(format!(
                    "Not a Git checkout: {}",
                    directory.display()
                )));
            }
            let origin = query(git(&directory).args(["config", "--get", "remote.origin.url"]))?;
            if origin.trim() != url {
                return Err(Error::Message(format!(
                    "Git origin does not match '{}' in {}",
                    url,
                    directory.display()
                )));
            }
            if !query(git(&directory).args(["status", "--porcelain", "--untracked-files=no"]))?
                .trim()
                .is_empty()
            {
                return Err(Error::Message(format!(
                    "Git checkout has local changes: {}",
                    directory.display()
                )));
            }
        }
        let version = if package.version.as_deref() == Some("latest") {
            let mut command = Command::new("git");
            command.args([
                "-c",
                "versionsort.suffix=-",
                "ls-remote",
                "--tags",
                "--refs",
                "--sort=-version:refname",
                "--",
                url,
            ]);
            if let Some(pattern) = &package.git_release_tag_pattern {
                command.arg(format!("refs/tags/{pattern}"));
            }
            let tags = query(&mut command)?;
            let selected = git_versions::latest(&tags, package.git_include_prereleases)?;
            if selected.is_none()
                && let Some(pattern) = &package.git_release_tag_pattern
            {
                return Err(Error::Message(format!(
                    "No Git tags match '{pattern}' for '{}'",
                    package.name
                )));
            }
            selected
        } else {
            package.version.clone()
        };
        let latest_tag = package.version.as_deref() == Some("latest") && version.is_some();
        if !existing {
            let mut command = Command::new("git");
            command.args([
                "clone",
                "--depth",
                "1",
                "--single-branch",
                "--no-tags",
                "--no-local",
            ]);
            if let Some(version) = &version {
                command
                    .arg("--branch")
                    .arg(version.strip_prefix("refs/tags/").unwrap_or(version));
            }
            execute(command.arg("--").arg(url).arg(&directory))?;
            if latest_tag
                && !query(git(&directory).args(["branch", "--show-current"]))?
                    .trim()
                    .is_empty()
            {
                checkout_git_ref(&directory, version.as_deref().unwrap())?;
            }
        } else {
            let branch = query(git(&directory).args(["branch", "--show-current"]))?;
            // Ref changes detach HEAD. Do not discard commits that belong to neither a
            // retained ref nor our previous fetch when choosing a new remote revision.
            if branch.trim().is_empty()
                && query(git(&directory).args([
                    "for-each-ref",
                    "--contains=HEAD",
                    "--format=%(refname)",
                ]))?
                .trim()
                .is_empty()
            {
                let revisions = query(git(&directory).args([
                    "rev-parse",
                    "--revs-only",
                    "HEAD",
                    "FETCH_HEAD^{commit}",
                ]))?;
                let mut revisions = revisions.lines();
                if revisions.next() != revisions.next() {
                    return Err(Error::Message(format!(
                        "Git checkout has unreferenced local commits: {}",
                        directory.display()
                    )));
                }
            }
            if !latest_tag
                && !branch.trim().is_empty()
                && version
                    .as_deref()
                    .is_none_or(|version| version == branch.trim())
            {
                execute(git(&directory).args(["pull", "--ff-only", "--no-rebase", "--no-tags"]))?;
            } else {
                checkout_git_ref(&directory, version.as_deref().unwrap_or("HEAD"))?;
            }
        }
        run_commands(package, &directory, version.as_deref())?;
        report.installed.push(package.name.clone());
    }
    Ok(report)
}

/// Link local source directories under `~/.local` and run their recipe commands there.
/// Replaces existing links and removes existing destination directories without backups.
/// Sources must remain available; command failure does not restore a replaced destination.
pub fn install_via_local(packages: &[Package]) -> Result<Report> {
    if packages.is_empty() {
        return Ok(Report::default());
    }
    require_user()?;
    let local = local_root()?;
    let root = resolve_path(&local)?;
    let mut names = HashSet::new();
    let mut prepared: Vec<(&Package, PathBuf, PathBuf)> = Vec::new();
    for package in packages {
        identifier(&package.name)?;
        if !names.insert(&package.name) {
            return Err(Error::Message(format!(
                "Duplicate local package '{}'",
                package.name
            )));
        }
        if package.version.is_some() {
            return Err(Error::Message(
                "Local packages use their source directly; version selection is not supported."
                    .into(),
            ));
        }
        validate_commands(package)?;
        let url = package
            .url
            .as_deref()
            .filter(|url| !url.trim().is_empty() && !url.contains('\0'))
            .ok_or_else(|| {
                Error::Message(format!(
                    "Missing or invalid local source for '{}'",
                    package.name
                ))
            })?;
        let source = fs::canonicalize(url)
            .map_err(|error| io_error("locate local package source", Path::new(url), error))?;
        if !source.is_dir() {
            return Err(Error::Message(format!(
                "Local package source must be a directory: {}",
                source.display()
            )));
        }
        let destination = package
            .destination
            .clone()
            .unwrap_or_else(|| Path::new("src").join(&package.name));
        if destination.as_os_str().is_empty()
            || destination
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(Error::Message(format!(
                "Local destination must be a relative path inside ~/.local: {}",
                destination.display()
            )));
        }
        let directory = local_destination(&local.join(destination), &root, &source)?;
        if prepared.iter().any(|(_, other_source, other)| {
            directory.starts_with(other)
                || other.starts_with(&directory)
                || source.starts_with(other)
                || other_source.starts_with(&directory)
        }) {
            return Err(Error::Message(format!(
                "Overlapping local package paths: {}",
                directory.display()
            )));
        }
        prepared.push((package, source, directory));
    }
    let mut report = Report::default();
    for (package, source, directory) in prepared {
        let directory = local_destination(&directory, &root, &source)?;
        let remove_directory = match fs::symlink_metadata(&directory) {
            Ok(metadata) if metadata.is_symlink() => false,
            Ok(metadata) if metadata.is_dir() => true,
            Ok(_) => {
                return Err(Error::Message(format!(
                    "Local package destination is an existing file: {}",
                    directory.display()
                )));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => false,
            Err(error) => return Err(io_error("inspect local package link", &directory, error)),
        };
        let parent = directory.parent().unwrap();
        fs::create_dir_all(parent)
            .map_err(|error| io_error("create local package directory", parent, error))?;
        let staged = tempfile::tempdir_in(parent)
            .map_err(|error| io_error("prepare local package link", parent, error))?;
        let link = staged.path().join("link");
        symlink(&source, &link)
            .map_err(|error| io_error("prepare local package link", &link, error))?;
        if remove_directory {
            fs::remove_dir_all(&directory)
                .map_err(|error| io_error("remove local package directory", &directory, error))?;
        }
        fs::rename(&link, &directory)
            .map_err(|error| io_error("replace local package link", &directory, error))?;
        run_commands(package, &directory, None)?;
        report.installed.push(package.name.clone());
    }
    Ok(report)
}

fn local_root() -> Result<PathBuf> {
    let home = env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| Error::Message("HOME is not set.".into()))?;
    if !home.is_absolute() || home.parent().is_none() {
        return Err(Error::Message(
            "HOME must be an absolute user home directory.".into(),
        ));
    }
    Ok(home.join(".local"))
}

fn resolve_path(path: &Path) -> Result<PathBuf> {
    match fs::symlink_metadata(path) {
        Ok(_) => fs::canonicalize(path)
            .map_err(|error| io_error("resolve local package directory", path, error)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            match (path.parent(), path.file_name()) {
                (Some(parent), Some(name)) => Ok(resolve_path(parent)?.join(name)),
                _ => Err(io_error("resolve local package directory", path, error)),
            }
        }
        Err(error) => Err(io_error("inspect local package directory", path, error)),
    }
}

fn local_destination(directory: &Path, root: &Path, source: &Path) -> Result<PathBuf> {
    // Resolve parent links for containment checks while replacing the final link itself.
    let directory = resolve_path(directory.parent().unwrap())?.join(directory.file_name().unwrap());
    if !directory.starts_with(root)
        || directory.starts_with(source)
        || source.starts_with(&directory)
    {
        return Err(Error::Message(format!(
            "Local destination must stay inside ~/.local without overlapping its source: {}",
            directory.display()
        )));
    }
    Ok(directory)
}

fn validate_commands(package: &Package) -> Result<()> {
    if package.command.iter().any(|command| {
        command
            .first()
            .is_none_or(|program| program.trim().is_empty())
            || command.iter().any(|argument| argument.contains('\0'))
    }) {
        return Err(Error::Message(format!(
            "Invalid command for '{}'",
            package.name
        )));
    }
    Ok(())
}

fn run_commands(package: &Package, directory: &Path, version: Option<&str>) -> Result<()> {
    for arguments in &package.command {
        let mut command = Command::new(&arguments[0]);
        command.args(&arguments[1..]).current_dir(directory);
        if let Some(repository) = &package.repository {
            command.env("LUNA_NEXT_ROOT", repository);
        }
        // Recipes need the selected tag, rather than the literal "latest", for release assets.
        if let Some(version) = version {
            command.env(
                "LUNA_PACKAGE_VERSION",
                version.strip_prefix("refs/tags/").unwrap_or(version),
            );
        } else {
            command.env_remove("LUNA_PACKAGE_VERSION");
        }
        execute(&mut command)?;
    }
    Ok(())
}

fn git_url(package: &Package) -> Result<&str> {
    package
        .url
        .as_deref()
        .filter(|url| !url.trim().is_empty() && !url.contains('\0'))
        .ok_or_else(|| Error::Message(format!("Missing or invalid Git URL for '{}'", package.name)))
}

fn checkout_git_ref(directory: &Path, reference: &str) -> Result<()> {
    execute(git(directory).args([
        "fetch",
        "--depth",
        "1",
        "--no-tags",
        "--",
        "origin",
        reference,
    ]))?;
    execute(git(directory).args(["checkout", "--detach", "FETCH_HEAD"]))
}

fn git(directory: &Path) -> Command {
    let mut command = Command::new("git");
    command.arg("-C").arg(directory);
    command
}

fn query(command: &mut Command) -> Result<String> {
    let description = format!("{command:?}");
    let output = command
        .stdin(Stdio::inherit())
        .stderr(Stdio::inherit())
        .output()
        .map_err(|error| Error::Message(format!("Cannot run {description}: {error}")))?;
    if !output.status.success() {
        return Err(Error::Message(format!(
            "Command failed ({}): {description}",
            output.status
        )));
    }
    String::from_utf8(output.stdout).map_err(|error| {
        Error::Message(format!(
            "Invalid command output from {description}: {error}"
        ))
    })
}

fn run(source: Source, packages: &[Package], command: &mut Command) -> Result<Report> {
    if packages.is_empty() && matches!(source, Source::Pacman | Source::Aur) {
        let source = if source == Source::Pacman {
            "pacman"
        } else {
            "AUR"
        };
        return Err(Error::Message(format!(
            "Specify at least one package to install with {source}."
        )));
    }

    let mut seen = HashSet::new();
    let mut names = Vec::new();
    for package in packages {
        identifier(&package.name)?;
        let name = if source == Source::Mise {
            let version = package.version.as_deref().unwrap_or("latest");
            if version.is_empty()
                || version
                    .chars()
                    .any(|ch| ch.is_whitespace() || ch.is_control())
            {
                return Err(Error::Message(format!(
                    "Invalid mise version '{version}' for '{}'",
                    package.name
                )));
            }
            match &package.version {
                Some(version) => format!("{}@{version}", package.name),
                None => package.name.clone(),
            }
        } else {
            if package.version.is_some() {
                return Err(Error::Message(
                    "Version selection is not supported for pacman or AUR packages.".into(),
                ));
            }
            package.name.clone()
        };
        if seen.insert((&package.name, &package.version)) {
            names.push(name);
        }
    }

    require_user()?;
    execute(command.args(&names))?;
    Ok(Report {
        installed: names,
        skipped: Vec::new(),
    })
}

fn require_user() -> Result<()> {
    if unsafe { libc::geteuid() } == 0 {
        return Err(Error::Message(
            "Run luna as your normal user, without sudo.".into(),
        ));
    }
    Ok(())
}

fn execute(command: &mut Command) -> Result<()> {
    let description = format!("{command:?}");
    let status = command
        .stdin(Stdio::inherit())
        // Keep stdout available for the CLI's single JSON response.
        .stdout(Stdio::from(std::io::stderr()))
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| Error::Message(format!("Cannot run {description}: {error}")))?;
    if !status.success() {
        return Err(Error::Message(format!(
            "Command failed ({status}): {description}"
        )));
    }
    Ok(())
}

pub(super) fn identifier(name: &str) -> Result<()> {
    if name.is_empty()
        || name.starts_with(['-', '.'])
        || !name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "_+.-".contains(ch))
    {
        return Err(Error::Message(format!("Invalid package name '{name}'")));
    }
    Ok(())
}
