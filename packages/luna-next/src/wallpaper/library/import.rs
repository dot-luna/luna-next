mod commit;

use super::download::download;
use super::files::{canonicalize, destination_metadata, same_contents, scan};
use super::{AddOptions, ImportResult, Library, STAGING_PREFIX, message};
use crate::{Result, io_error};
use std::collections::HashMap;
use std::fs::{self, File};
use std::path::{Path, PathBuf};

struct Import {
    source: PathBuf,
    destination: PathBuf,
    added: bool,
    previous: Option<fs::Metadata>,
}

impl Library {
    /// Validate the complete import batch before changing existing library files.
    pub fn add(&self, targets: &[String], options: &AddOptions) -> Result<Vec<ImportResult>> {
        if targets.is_empty() {
            return Ok(Vec::new());
        }
        let downloads = tempfile::tempdir()
            .map_err(|error| io_error("stage wallpaper downloads", &self.directory, error))?;
        let mut sources = Vec::new();
        for (index, target) in targets.iter().enumerate() {
            let lower = target.to_ascii_lowercase();
            if lower.starts_with("http://") || lower.starts_with("https://") {
                sources.push(download(target, downloads.path(), index)?);
                continue;
            }
            if target.contains("://") {
                return Err(message("Only HTTP and HTTPS wallpaper URLs are supported"));
            }
            let path = canonicalize(Path::new(target))?;
            if path.is_dir() {
                let files = scan(&path, options.recursive, true)?;
                if files.is_empty() {
                    return Err(message(format!("No supported media in folder: {target}")));
                }
                sources.extend(files);
            } else {
                sources.push(path);
            }
        }

        let mut names: HashMap<std::ffi::OsString, PathBuf> = HashMap::new();
        let mut plan = Vec::new();
        for source in sources {
            self.validate(&source)?;
            let name = source
                .file_name()
                .ok_or_else(|| message("Wallpaper has no filename"))?
                .to_owned();
            if name.to_string_lossy().starts_with(STAGING_PREFIX) {
                return Err(message("Wallpaper filename uses a reserved staging prefix"));
            }
            if let Some(previous) = names.get(&name) {
                if !same_contents(previous, &source)? {
                    return Err(message(format!(
                        "Different wallpapers share a filename: {}",
                        name.to_string_lossy()
                    )));
                }
                continue;
            }
            names.insert(name.clone(), source.clone());
            let destination = self.directory.join(name);
            plan.push(Import {
                source,
                destination,
                added: true,
                previous: None,
            });
        }

        fs::create_dir_all(&self.directory)
            .map_err(|error| io_error("create wallpaper library", &self.directory, error))?;
        let _lock = self.lock()?;
        for entry in &mut plan {
            entry.previous = destination_metadata(&entry.destination)?;
            let unchanged =
                entry.previous.is_some() && same_contents(&entry.source, &entry.destination)?;
            if entry.previous.is_some() && !unchanged && !options.force {
                return Err(message(format!(
                    "Different wallpaper already installed: {}; rename it or use --force",
                    entry.destination.display()
                )));
            }
            entry.added = !unchanged;
        }
        let transaction = self.transaction()?;
        for (index, entry) in plan.iter().enumerate() {
            if entry.added {
                let staged = transaction.path().join(format!("new-{index}"));
                fs::copy(&entry.source, &staged)
                    .map_err(|error| io_error("stage wallpaper", &entry.source, error))?;
                File::open(&staged)
                    .and_then(|file| file.sync_all())
                    .map_err(|error| io_error("sync wallpaper", &staged, error))?;
            }
        }
        commit::apply(transaction, &plan)?;
        let root = canonicalize(&self.directory)?;
        Ok(plan
            .into_iter()
            .map(|entry| ImportResult {
                path: root.join(
                    entry
                        .destination
                        .file_name()
                        .expect("planned wallpaper filename"),
                ),
                added: entry.added,
            })
            .collect())
    }
}
