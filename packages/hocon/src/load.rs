//! Load local include sources through the checked parser. hocon-rs performs
//! value resolution, substitutions, include fixups, and merging. Its native file
//! loader cannot apply the EOF validation needed by the pinned parser version.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use hocon_rs::{
    Error,
    raw::{
        concat::Concat,
        field::ObjectField,
        include::{Inclusion, Location},
        raw_object::RawObject,
        raw_value::RawValue,
    },
};
use serde_json::Value;

pub(crate) fn resolve(path: &Path) -> hocon_rs::Result<Value> {
    let raw = file(path, &mut Vec::new(), true)?;
    hocon_rs::Config::from(raw).resolve()
}

pub(crate) fn resolve_value(path: &Path) -> hocon_rs::Result<Value> {
    const ROOT_ARRAY: &str = "__hocon_root_array__";
    let mut array = false;
    let raw = file_with(path, &mut Vec::new(), |_, source| {
        let scanner = crate::syntax::Scanner { source };
        let start = scanner.trivia(0, source.len());
        if source.as_bytes().get(start) != Some(&b'[') {
            return crate::syntax::validate(source);
        }
        let end = scanner
            .enclosed(start, source.len())
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
        if scanner.trivia(end, source.len()) != source.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unexpected content after root HOCON array",
            )
            .into());
        }
        array = true;
        crate::syntax::validate(&format!(
            "{}\"{ROOT_ARRAY}\" =\n{}\n",
            &source[..start],
            &source[start..]
        ))
    })?;
    let mut value: Value = hocon_rs::Config::from(raw).resolve()?;
    Ok(if array {
        value[ROOT_ARRAY].take()
    } else {
        value
    })
}

fn file(path: &Path, stack: &mut Vec<PathBuf>, entry_point: bool) -> hocon_rs::Result<RawObject> {
    file_with(path, stack, |path, source| {
        if !entry_point
            && path
                .extension()
                .is_some_and(|extension| extension == "json")
        {
            match RawValue::from(serde_json::from_str::<Value>(source)?) {
                RawValue::Object(object) => Ok(object),
                _ => Err(Error::InvalidValue {
                    val: "non-object root",
                    ty: "configuration",
                }),
            }
        } else {
            crate::syntax::validate(source)
        }
    })
}

fn file_with(
    path: &Path,
    stack: &mut Vec<PathBuf>,
    parse: impl FnOnce(&Path, &str) -> hocon_rs::Result<RawObject>,
) -> hocon_rs::Result<RawObject> {
    let path = fs::canonicalize(path)?;
    if stack.contains(&path) {
        return Err(Error::InclusionCycle);
    }
    if stack.len() >= 64 {
        return Err(Error::InclusionDepthExceeded { max_depth: 64 });
    }
    let source = fs::read_to_string(&path)?;
    let mut object = parse(&path, &source)?;
    stack.push(path.clone());
    let result = includes(
        &mut object,
        path.parent().expect("canonical path has a parent"),
        stack,
    );
    stack.pop();
    result?;
    Ok(object)
}

fn includes(object: &mut RawObject, base: &Path, stack: &mut Vec<PathBuf>) -> hocon_rs::Result<()> {
    for field in object.iter_mut() {
        match field {
            ObjectField::Inclusion { inclusion, .. } => match included(inclusion, base, stack) {
                Ok(object) => inclusion.val = Some(Box::new(object)),
                Err(Error::Io(error))
                    if !inclusion.required && error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(Error::Include {
                        inclusion: inclusion.to_string(),
                        error: Box::new(error),
                    });
                }
            },
            ObjectField::KeyValue { value, .. } => value_includes(value, base, stack)?,
            ObjectField::NewlineComment(_) => {}
        }
    }
    Ok(())
}

fn value_includes(
    value: &mut RawValue,
    base: &Path,
    stack: &mut Vec<PathBuf>,
) -> hocon_rs::Result<()> {
    match value {
        RawValue::Object(object) => includes(object, base, stack)?,
        RawValue::Array(array) => {
            for value in array.iter_mut() {
                value_includes(value, base, stack)?;
            }
        }
        RawValue::Concat(_) => {
            // Public Concat has no mutable accessor. Rebuild only this syntax
            // node in memory; this AST is never serialized to the user file.
            let RawValue::Concat(concat) = std::mem::replace(value, RawValue::Null) else {
                unreachable!()
            };
            let (mut values, spaces) = concat.into_inner();
            for value in &mut values {
                value_includes(value, base, stack)?;
            }
            *value = RawValue::Concat(Concat::new(values, spaces)?);
        }
        RawValue::AddAssign(value) => value_includes(value, base, stack)?,
        _ => {}
    }
    Ok(())
}

fn included(
    include: &Inclusion,
    base: &Path,
    stack: &mut Vec<PathBuf>,
) -> hocon_rs::Result<RawObject> {
    if include.location == Some(Location::Classpath) {
        return Err(io::Error::new(io::ErrorKind::NotFound, "no Java classpath configured").into());
    }
    let path = match url::Url::parse(&include.path) {
        Ok(url) if url.scheme() == "file" => url
            .to_file_path()
            .map_err(|()| Error::InvalidFileUrl(url.to_string()))?,
        Ok(_) if include.location != Some(Location::File) => {
            return Err(Error::UrlsIncludesDisabled);
        }
        _ if include.location == Some(Location::Url) => return Err(Error::UrlsIncludesDisabled),
        _ => PathBuf::from(include.path.as_str()),
    };
    let path = base.join(path);
    if path
        .extension()
        .is_some_and(|extension| extension == "conf" || extension == "json")
        || exists(&path)?
    {
        return file(&path, stack, false);
    }
    let mut merged = RawObject::default();
    let mut found = false;
    // HOCON gives .conf precedence when both formats exist.
    for extension in ["json", "conf"] {
        let candidate = path.with_extension(extension);
        if exists(&candidate)? {
            merged.extend(file(&candidate, stack, false)?.0);
            found = true;
        }
    }
    if !found {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("include '{}' does not exist", path.display()),
        )
        .into());
    }
    Ok(merged)
}

fn exists(path: &Path) -> hocon_rs::Result<bool> {
    match fs::metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}
