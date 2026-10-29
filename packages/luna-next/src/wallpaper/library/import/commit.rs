use super::super::files::destination_metadata;
use super::super::message;
use super::super::transaction::rollback;
use super::Import;
use crate::{Result, io_error};
use std::fs;
use std::os::unix::fs::MetadataExt;
use tempfile::TempDir;

pub(super) fn apply(transaction: TempDir, plan: &[Import]) -> Result<()> {
    let mut committed = Vec::new();
    for (index, entry) in plan.iter().enumerate() {
        if !entry.added {
            continue;
        }
        let destination = &entry.destination;
        let result = (|| {
            let backup = if let Some(previous) = &entry.previous {
                let unchanged = destination_metadata(destination)?
                    .is_some_and(|current| same_file(previous, &current));
                if !unchanged {
                    return Err(message(format!(
                        "Wallpaper changed during import; leaving it untouched: {}",
                        destination.display()
                    )));
                }
                let backup = transaction.path().join(format!("old-{index}"));
                fs::rename(destination, &backup)
                    .map_err(|error| io_error("back up wallpaper", destination, error))?;
                Some(backup)
            } else {
                None
            };
            committed.push((destination.clone(), backup, false));
            let staged = transaction.path().join(format!("new-{index}"));
            // A new destination is never moved aside, even if it appears during staging.
            fs::hard_link(&staged, destination)
                .map_err(|error| io_error("install wallpaper", destination, error))?;
            committed.last_mut().expect("current import").2 = true;
            Ok(())
        })();
        if let Err(error) = result {
            return Err(rollback(transaction, &committed, error));
        }
    }
    Ok(())
}

fn same_file(previous: &fs::Metadata, current: &fs::Metadata) -> bool {
    previous.dev() == current.dev()
        && previous.ino() == current.ino()
        && previous.len() == current.len()
        && previous.mtime() == current.mtime()
        && previous.mtime_nsec() == current.mtime_nsec()
        && previous.ctime() == current.ctime()
        && previous.ctime_nsec() == current.ctime_nsec()
}

#[cfg(test)]
#[path = "../../../../tests/unit/import_commit.rs"]
mod tests;
