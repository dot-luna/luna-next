//! Source spans are used only for editing; HOCON syntax and key interpretation
//! always come from hocon-rs. Edits apply to the opened file's source text.

use std::ops::Range;

use hocon_rs::raw::{field::ObjectField, raw_object::RawObject, raw_value::RawValue};
use serde_json::Value;

use crate::{
    Result,
    syntax::{Scanner, unsupported, validate},
};

fn parse(source: &str) -> Result<RawObject> {
    validate(source)
        .map_err(|error| unsupported(format!("cannot locate HOCON source fields: {error}")))
}

pub(crate) fn apply(source: &str, path: &[&str], value: Option<&Value>) -> Result<String> {
    let object = parse(source)?;
    let mut editor = Editor {
        scanner: Scanner { source },
        changes: Vec::new(),
    };
    let start = editor.scanner.trivia(0, source.len());
    let braced = source.as_bytes().get(start) == Some(&b'{');
    let body = if braced {
        start + 1..editor.scanner.enclosed(start, source.len())? - 1
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
    scanner: Scanner<'a>,
    changes: Vec<(Range<usize>, String)>,
}

impl Editor<'_> {
    fn object(&mut self, body: Range<usize>, object: &RawObject, path: &[&str]) -> Result<()> {
        let bytes = self.scanner.source.as_bytes();
        let mut position = body.start;
        for field in object.iter() {
            if matches!(field, ObjectField::NewlineComment(_)) {
                continue;
            }
            let start = self.scanner.trivia(position, body.end);
            if start >= body.end {
                return Err(unsupported(
                    "HOCON source fields do not match parsed fields",
                ));
            }
            let (value_start, end) = match field {
                ObjectField::Inclusion { .. } => {
                    (start, self.scanner.include_end(start, body.end)?)
                }
                ObjectField::KeyValue { .. } => {
                    let mut separator = start;
                    while separator < body.end {
                        match bytes[separator] {
                            b'"' => separator = self.scanner.quoted(separator, body.end)?,
                            b'=' | b':' | b'{' | b'+' => break,
                            _ => separator += 1,
                        }
                    }
                    if separator == body.end {
                        return Err(unsupported("cannot locate field separator"));
                    }
                    let value_start = self.scanner.whitespace(
                        separator
                            + match bytes[separator] {
                                b'{' => 0,
                                b'+' => 2,
                                _ => 1,
                            },
                        body.end,
                    );
                    (value_start, self.scanner.value_end(value_start, body.end)?)
                }
                ObjectField::NewlineComment(_) => unreachable!(),
            };

            // Fail closed if any lexical boundary disagrees with the actual parser.
            let parsed = parse(&self.scanner.source[start..end])?;
            if parsed.0.as_slice() != std::slice::from_ref(field) {
                return Err(unsupported(
                    "cannot safely identify a HOCON field's source span",
                ));
            }
            position = self.scanner.trivia(end, body.end);
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
        if self.scanner.trivia(position, body.end) != body.end {
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
            position = self.scanner.whitespace(position, span.end);
            if self.scanner.source.as_bytes().get(position) != Some(&b'{') {
                return Err(unsupported("cannot locate literal object body"));
            }
            let end = self.scanner.enclosed(position, span.end)?;
            self.object(position + 1..end - 1, object, path)?;
            position = end;
        }
        if self.scanner.whitespace(position, span.end) != span.end {
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
            if self.scanner.is_comment(position, range.end) {
                let end = self.scanner.comment_end(position, range.end);
                replacement.push_str(&self.scanner.source[position..end]);
                replacement.push('\n');
                position = end;
            } else if self.scanner.source.as_bytes()[position] == b'"' {
                position = self.scanner.quoted(position, range.end)?;
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
