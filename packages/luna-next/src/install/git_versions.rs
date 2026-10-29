use semver::Version;

use crate::{Error, Result};

/// Select the first eligible tag from Git's descending version-sorted output.
pub(super) fn latest(tags: &str, include_prereleases: bool) -> Result<Option<String>> {
    let mut references = tags
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .filter_map(|(_, reference)| {
            reference
                .strip_prefix("refs/tags/")
                .map(|tag| (reference, tag))
        })
        .peekable();
    if references.peek().is_none() {
        return Ok(None);
    }
    references
        .find(|(_, tag)| {
            include_prereleases || version(tag).is_none_or(|version| version.pre.is_empty())
        })
        .map(|(reference, _)| Some(reference.to_owned()))
        .ok_or_else(|| {
            Error::Message(
                "No stable Git tags; choose an explicit ref or set git_include_prereleases = true."
                    .into(),
            )
        })
}

fn version(tag: &str) -> Option<Version> {
    let text = tag.strip_prefix('v').unwrap_or(tag);
    let end = text.find(['-', '+']).unwrap_or(text.len());
    let (numbers, suffix) = text.split_at(end);
    // Pad omitted numbers before checking the tag's SemVer prerelease suffix.
    let missing = 3usize.checked_sub(numbers.split('.').count())?;
    Version::parse(&format!("{numbers}{}{suffix}", ".0".repeat(missing))).ok()
}
