//! Source spans are used only for editing; HOCON syntax and key interpretation
//! always come from hocon-rs. Edits apply to the opened file's source text.

use std::{borrow::Cow, ops::Range};

use hocon_rs::{
    parser::{
        HoconParser,
        read::{StrRead, leading_whitespace_bytes},
    },
    raw::{field::ObjectField, raw_object::RawObject, raw_value::RawValue},
};
use serde_json::Value;

use crate::{Error, Result};

fn unsupported(message: impl Into<String>) -> Error {
    Error::Edit {
        message: message.into(),
    }
}

fn parse(source: &str) -> Result<RawObject> {
    validate(source)
        .map_err(|error| unsupported(format!("cannot locate HOCON source fields: {error}")))
}

/// Work around hocon-rs treating some unexpected EOF errors as the end of an
/// object. Check lexical closure, then prove the parser reaches an extra field.
/// The sentinel is only parsed in memory and never returned or written.
pub(crate) fn validate(source: &str) -> std::result::Result<RawObject, hocon_rs::Error> {
    fn invalid(message: impl Into<String>) -> hocon_rs::Error {
        std::io::Error::new(std::io::ErrorKind::InvalidData, message.into()).into()
    }
    let scanner = Editor {
        source,
        changes: Vec::new(),
    };
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
    let scanner = Editor {
        source,
        changes: Vec::new(),
    };
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

pub(crate) fn apply(source: &str, path: &[&str], value: Option<&Value>) -> Result<String> {
    let object = parse(source)?;
    let mut editor = Editor {
        source,
        changes: Vec::new(),
    };
    let start = editor.trivia(0, source.len());
    let braced = source.as_bytes().get(start) == Some(&b'{');
    let body = if braced {
        start + 1..editor.enclosed(start, source.len())? - 1
    } else {
        start..source.len()
    };
    let insertion = body.end;
    editor.object(body, &object, path)?;
    if value.is_none() && editor.changes.is_empty() {
        return Ok(source.to_owned());
    }
    editor
        .changes
        .sort_unstable_by_key(|(range, _)| range.start);
    let mut output = String::with_capacity(source.len());
    let mut cursor = 0;
    for (range, replacement) in editor.changes {
        if range.start < cursor {
            return Err(unsupported("overlapping source edits"));
        }
        output.push_str(&source[cursor..range.start]);
        output.push_str(&replacement);
        cursor = range.end;
    }
    output.push_str(&source[cursor..]);

    if let Some(value) = value {
        // HOCON gives this final assignment precedence over earlier fields.
        let key = path
            .iter()
            .map(serde_json::to_string)
            .collect::<std::result::Result<Vec<_>, _>>()?
            .join(".");
        let newline = if source.contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        };
        let insertion = output.len() - (source.len() - insertion);
        let prefix = if insertion > 0 && !output[..insertion].ends_with('\n') {
            newline
        } else {
            ""
        };
        let indent = if braced { "  " } else { "" };
        output.insert_str(
            insertion,
            &format!(
                "{prefix}{indent}{key} = {}{newline}",
                serde_json::to_string(value)?
            ),
        );
    }
    // Verify the edited source before it is handed to the resolving/writing layer.
    parse(&output)?;
    Ok(output)
}

struct Editor<'a> {
    source: &'a str,
    changes: Vec<(Range<usize>, String)>,
}

impl Editor<'_> {
    fn whitespace(&self, mut position: usize, end: usize) -> usize {
        while position < end {
            let count = leading_whitespace_bytes(&self.source.as_bytes()[position..end]);
            if count == 0 {
                break;
            }
            position += count;
        }
        position
    }

    fn is_comment(&self, position: usize, end: usize) -> bool {
        let rest = &self.source.as_bytes()[position..end];
        rest.starts_with(b"#") || rest.starts_with(b"//")
    }

    fn comment_end(&self, position: usize, end: usize) -> usize {
        self.source.as_bytes()[position..end]
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(end, |offset| position + offset)
    }

    fn trivia(&self, mut position: usize, end: usize) -> usize {
        loop {
            position = self.whitespace(position, end);
            if position == end || !self.is_comment(position, end) {
                return position;
            }
            position = self.comment_end(position, end);
        }
    }

    fn quoted(&self, start: usize, end: usize) -> Result<usize> {
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
    fn enclosed(&self, start: usize, end: usize) -> Result<usize> {
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

    fn value_end(&self, mut position: usize, end: usize) -> Result<usize> {
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

    fn include_end(&self, mut position: usize, end: usize) -> Result<usize> {
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

    fn object(&mut self, body: Range<usize>, object: &RawObject, path: &[&str]) -> Result<()> {
        let bytes = self.source.as_bytes();
        let mut position = body.start;
        for field in object.iter() {
            if matches!(field, ObjectField::NewlineComment(_)) {
                continue;
            }
            let start = self.trivia(position, body.end);
            if start >= body.end {
                return Err(unsupported(
                    "HOCON source fields do not match parsed fields",
                ));
            }
            let (value_start, end) = match field {
                ObjectField::Inclusion { .. } => (start, self.include_end(start, body.end)?),
                ObjectField::KeyValue { .. } => {
                    let mut separator = start;
                    while separator < body.end {
                        match bytes[separator] {
                            b'"' => separator = self.quoted(separator, body.end)?,
                            b'=' | b':' | b'{' | b'+' => break,
                            _ => separator += 1,
                        }
                    }
                    if separator == body.end {
                        return Err(unsupported("cannot locate field separator"));
                    }
                    let value_start = self.whitespace(
                        separator
                            + match bytes[separator] {
                                b'{' => 0,
                                b'+' => 2,
                                _ => 1,
                            },
                        body.end,
                    );
                    (value_start, self.value_end(value_start, body.end)?)
                }
                ObjectField::NewlineComment(_) => unreachable!(),
            };

            // Fail closed if any lexical boundary disagrees with the actual parser.
            let parsed = parse(&self.source[start..end])?;
            if parsed.0.as_slice() != std::slice::from_ref(field) {
                return Err(unsupported(
                    "cannot safely identify a HOCON field's source span",
                ));
            }
            position = self.trivia(end, body.end);
            let comma = if bytes.get(position) == Some(&b',') && position < body.end {
                position += 1;
                Some(position - 1)
            } else {
                None
            };

            if let ObjectField::KeyValue { key, value, .. } = field {
                let key = key.as_path();
                if key.starts_with(path) {
                    if contains_include(value) {
                        return Err(unsupported(
                            "cannot remove or replace an object containing include directives; edit its individual local keys instead",
                        ));
                    }
                    self.remove(start..end)?;
                    if let Some(comma) = comma {
                        self.changes.push((comma..comma + 1, String::new()));
                    }
                } else if path.starts_with(&key) {
                    self.children(value_start..end, value, &path[key.len()..])?;
                }
            }
        }
        if self.trivia(position, body.end) != body.end {
            return Err(unsupported(
                "unrecognized HOCON source after the last parsed field",
            ));
        }
        Ok(())
    }

    fn children(&mut self, span: Range<usize>, value: &RawValue, path: &[&str]) -> Result<()> {
        // Such a value cannot define any child field to remove. Dynamic
        // object substitutions remain ambiguous and are rejected below.
        if literal_nonobject(value) {
            return Ok(());
        }
        let objects: Vec<&RawObject> = match value {
            RawValue::Object(object) => vec![object],
            RawValue::Concat(concat) => concat
                .get_values()
                .iter()
                .map(|part| match part {
                    RawValue::Object(object) => Ok(object),
                    _ => Err(unsupported(
                        "cannot safely edit a child of a nonliteral object concatenation",
                    )),
                })
                .collect::<Result<_>>()?,
            _ => {
                return Err(unsupported(
                    "cannot safely edit a child beneath a substitution; edit the ancestor key instead",
                ));
            }
        };
        let mut position = span.start;
        for object in objects {
            position = self.whitespace(position, span.end);
            if self.source.as_bytes().get(position) != Some(&b'{') {
                return Err(unsupported("cannot locate literal object body"));
            }
            let end = self.enclosed(position, span.end)?;
            self.object(position + 1..end - 1, object, path)?;
            position = end;
        }
        if self.whitespace(position, span.end) != span.end {
            return Err(unsupported("unexpected source following literal object"));
        }
        Ok(())
    }

    fn remove(&mut self, range: Range<usize>) -> Result<()> {
        // Keep comments located inside a removed value, too. Quotes are skipped
        // so comment-looking text inside strings is removed with the value.
        let mut replacement = String::new();
        let mut position = range.start;
        while position < range.end {
            if self.is_comment(position, range.end) {
                let end = self.comment_end(position, range.end);
                replacement.push_str(&self.source[position..end]);
                replacement.push('\n');
                position = end;
            } else if self.source.as_bytes()[position] == b'"' {
                position = self.quoted(position, range.end)?;
            } else {
                position += 1;
            }
        }
        self.changes.push((range, replacement));
        Ok(())
    }
}

fn literal_nonobject(value: &RawValue) -> bool {
    match value {
        RawValue::Array(_)
        | RawValue::Boolean(_)
        | RawValue::Null
        | RawValue::String(_)
        | RawValue::Number(_)
        | RawValue::AddAssign(_) => true,
        RawValue::Concat(concat) => concat.get_values().iter().all(literal_nonobject),
        _ => false,
    }
}

fn contains_include(value: &RawValue) -> bool {
    match value {
        RawValue::Object(object) => object.iter().any(|field| match field {
            ObjectField::Inclusion { .. } => true,
            ObjectField::KeyValue { value, .. } => contains_include(value),
            ObjectField::NewlineComment(_) => false,
        }),
        RawValue::Array(array) => array.iter().any(contains_include),
        RawValue::Concat(concat) => concat.get_values().iter().any(contains_include),
        RawValue::AddAssign(value) => contains_include(value),
        _ => false,
    }
}

#[cfg(test)]
#[path = "../tests/unit/edit.rs"]
mod tests;
