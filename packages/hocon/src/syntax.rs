//! Checked HOCON parsing and source boundaries shared by loading and editing.

use std::borrow::Cow;

use hocon_rs::{
    parser::{
        HoconParser,
        read::{StrRead, leading_whitespace_bytes},
    },
    raw::{field::ObjectField, raw_object::RawObject, raw_value::RawValue},
};

use crate::{Error, Result};

pub(crate) fn unsupported(message: impl Into<String>) -> Error {
    Error::Edit {
        message: message.into(),
    }
}

/// Work around hocon-rs treating some unexpected EOF errors as the end of an
/// object. Check lexical closure, then prove the parser reaches an extra field.
/// The sentinel is only parsed in memory and never returned or written.
pub(crate) fn validate(source: &str) -> std::result::Result<RawObject, hocon_rs::Error> {
    fn invalid(message: impl Into<String>) -> hocon_rs::Error {
        std::io::Error::new(std::io::ErrorKind::InvalidData, message.into()).into()
    }
    let scanner = Scanner { source };
    let bytes = source.as_bytes();
    let mut position = 0;
    while position < source.len() {
        if scanner.is_comment(position, source.len()) {
            position = scanner.comment_end(position, source.len());
            continue;
        }
        position = match bytes[position] {
            b'"' => scanner
                .quoted(position, source.len())
                .map_err(|error| invalid(error.to_string()))?,
            b'{' | b'[' => scanner
                .enclosed(position, source.len())
                .map_err(|error| invalid(error.to_string()))?,
            b'}' | b']' => return Err(invalid("unmatched closing HOCON delimiter")),
            _ => position + 1,
        };
    }

    let start = scanner.trivia(0, source.len());
    let insertion = if bytes.get(start) == Some(&b'{') {
        scanner
            .enclosed(start, source.len())
            .map_err(|error| invalid(error.to_string()))?
            - 1
    } else {
        source.len()
    };
    let mut sentinel = "__hocon_source_validation__".to_string();
    while source.contains(&sentinel) {
        sentinel.push('_');
    }
    let mut guarded = source.to_string();
    guarded.insert_str(insertion, &format!("\n\"{sentinel}\" = null\n"));
    let normalized = normalize_multiline(&guarded).map_err(|error| invalid(error.to_string()))?;
    let mut checked = HoconParser::new(StrRead::new(&normalized)).parse()?;
    let reached_sentinel = matches!(
        checked.0.pop(),
        Some(ObjectField::KeyValue { key, value: RawValue::Null, .. })
            if key.as_path() == [sentinel.as_str()]
    );
    if !reached_sentinel {
        return Err(invalid("incomplete HOCON source at end of file"));
    }
    // The guard also fixes short final keys beginning with 'i': the backend's
    // include lookahead otherwise consumes an EOF and silently drops that key.
    Ok(checked)
}

// The backend closes multiline strings at the first three quotes. HOCON uses
// the final three in a closing run, retaining earlier quotes as string content.
// Normalize only affected tokens in memory; editing still uses original spans.
fn normalize_multiline(source: &str) -> Result<Cow<'_, str>> {
    if !source.contains("\"\"\"\"") {
        return Ok(Cow::Borrowed(source));
    }
    let scanner = Scanner { source };
    let mut changes = Vec::new();
    let mut position = 0;
    while position < source.len() {
        if scanner.is_comment(position, source.len()) {
            position = scanner.comment_end(position, source.len());
        } else if source.as_bytes()[position] == b'"' {
            let end = scanner.quoted(position, source.len())?;
            if source.as_bytes()[position..end].starts_with(b"\"\"\"") {
                let content = &source[position + 3..end - 3];
                if content.ends_with('"') {
                    changes.push((position..end, serde_json::to_string(content)?));
                }
            }
            position = end;
        } else {
            position += 1;
        }
    }
    if changes.is_empty() {
        return Ok(Cow::Borrowed(source));
    }
    let mut normalized = String::with_capacity(source.len());
    let mut cursor = 0;
    for (range, replacement) in changes {
        normalized.push_str(&source[cursor..range.start]);
        normalized.push_str(&replacement);
        cursor = range.end;
    }
    normalized.push_str(&source[cursor..]);
    Ok(Cow::Owned(normalized))
}

/// Locate byte spans in the original source; the backend parser remains the
/// authority on field meanings. Offsets are never taken from normalized tokens.
pub(crate) struct Scanner<'a> {
    pub(crate) source: &'a str,
}

impl Scanner<'_> {
    pub(crate) fn whitespace(&self, mut position: usize, end: usize) -> usize {
        while position < end {
            let count = leading_whitespace_bytes(&self.source.as_bytes()[position..end]);
            if count == 0 {
                break;
            }
            position += count;
        }
        position
    }

    pub(crate) fn is_comment(&self, position: usize, end: usize) -> bool {
        let rest = &self.source.as_bytes()[position..end];
        rest.starts_with(b"#") || rest.starts_with(b"//")
    }

    pub(crate) fn comment_end(&self, position: usize, end: usize) -> usize {
        self.source.as_bytes()[position..end]
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(end, |offset| position + offset)
    }

    pub(crate) fn trivia(&self, mut position: usize, end: usize) -> usize {
        loop {
            position = self.whitespace(position, end);
            if position == end || !self.is_comment(position, end) {
                return position;
            }
            position = self.comment_end(position, end);
        }
    }

    pub(crate) fn quoted(&self, start: usize, end: usize) -> Result<usize> {
        let bytes = self.source.as_bytes();
        if bytes[start..end].starts_with(b"\"\"\"") {
            let close = bytes[start + 3..end]
                .windows(3)
                .position(|window| window == b"\"\"\"")
                .map(|offset| start + 3 + offset + 3)
                .ok_or_else(|| unsupported("unterminated multiline string"))?;
            let extra = bytes[close..end]
                .iter()
                .take_while(|byte| **byte == b'"')
                .count();
            return Ok(close + extra);
        }
        let mut position = start + 1;
        while position < end {
            match bytes[position] {
                b'\\' => position += 2,
                b'"' => return Ok(position + 1),
                _ => position += 1,
            }
        }
        Err(unsupported("unterminated quoted string"))
    }

    /// Skip an object, array, substitution, or include argument list, respecting
    /// literal strings and comments. This does not interpret their contents.
    pub(crate) fn enclosed(&self, start: usize, end: usize) -> Result<usize> {
        let bytes = self.source.as_bytes();
        let parentheses = bytes[start] == b'(';
        let mut stack = Vec::new();
        let mut position = start;
        while position < end {
            if self.is_comment(position, end) {
                position = self.comment_end(position, end);
                continue;
            }
            match bytes[position] {
                b'"' => {
                    position = self.quoted(position, end)?;
                    continue;
                }
                b'{' => stack.push(b'}'),
                b'[' => stack.push(b']'),
                b'(' if parentheses => stack.push(b')'),
                b'}' | b']' => {
                    if stack.pop() != Some(bytes[position]) {
                        return Err(unsupported("unbalanced source delimiters"));
                    }
                    if stack.is_empty() {
                        return Ok(position + 1);
                    }
                }
                b')' if parentheses => {
                    if stack.pop() != Some(b')') {
                        return Err(unsupported("unbalanced include arguments"));
                    }
                    if stack.is_empty() {
                        return Ok(position + 1);
                    }
                }
                _ => {}
            }
            position += 1;
        }
        Err(unsupported("unterminated source delimiter"))
    }

    pub(crate) fn value_end(&self, mut position: usize, end: usize) -> Result<usize> {
        let bytes = self.source.as_bytes();
        while position < end {
            if self.is_comment(position, end) {
                break;
            }
            match bytes[position] {
                b'"' => position = self.quoted(position, end)?,
                b'{' | b'[' => position = self.enclosed(position, end)?,
                b',' | b'}' | b']' | b'\n' => break,
                b'\r' if bytes.get(position + 1) == Some(&b'\n') => break,
                _ => position += 1,
            }
        }
        Ok(position)
    }

    pub(crate) fn include_end(&self, mut position: usize, end: usize) -> Result<usize> {
        let bytes = self.source.as_bytes();
        while position < end {
            match bytes[position] {
                b'"' => return self.quoted(position, end),
                b'(' => return self.enclosed(position, end),
                _ => position += 1,
            }
        }
        Err(unsupported("cannot locate include directive"))
    }
}

#[cfg(test)]
#[path = "../tests/unit/syntax.rs"]
mod tests;
