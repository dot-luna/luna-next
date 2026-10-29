use super::*;
use serde_json::json;

#[test]
fn validation_rejects_truncated_fields_strings_includes_and_delimiters() {
    for source in [
        "broken {\n",
        "a =",
        "a =\n",
        "a",
        "good = 1\nbroken =",
        "a = \"unterminated",
        "a = \"\"\"unterminated",
        "a=\"\"\"hello\"\"\nb=2",
        "a = [1, { b = 2 ]",
        "a = { b = [1, 2 }",
        "a = [1, 2",
        "a = ${missing",
        "include",
        "include file(",
        "include file(\"base.conf\"",
        "include required(file(\"base.conf\")",
        "a=1\n}",
        "{ a = }",
        "{ a = 1, b }",
    ] {
        assert!(
            validate(source).is_err(),
            "accepted malformed source: {source:?}"
        );
    }
}

#[test]
fn validation_accepts_read_syntax_beyond_editable_literal_objects() {
    for source in [
        "",
        "# comments only",
        "{} // trailing comment",
        "{ a = null, b = [true, 1, { c = \"text\" }] }",
        "base={a=1}\nvalue=${base}\nvalue=${base} {b=2}",
        "a = ${?OPTIONAL}\nb = prefix${base}suffix",
        "include required(file(\"defaults.conf\"))",
        "{ include \"defaults.conf\"\na = 2 # trailing\n}",
        "a = \"\"\"# // {[\n some text\"\"\"\nb = \"escaped\\\"quote\"",
        "a = foo(unmatched\nb = x)\n",
        "a = [1] [2]\na += 3\n",
        "\u{feff}{\r\n a = 1,\r\n}\r\n",
        "__hocon_source_validation__ = 1",
    ] {
        let expected = HoconParser::new(StrRead::new(source)).parse().unwrap();
        assert_eq!(validate(source).unwrap(), expected, "source: {source:?}");
    }
}

#[test]
fn validates_and_edits_short_final_keys_starting_with_i() {
    for source in ["i=1", "id=2", "in=3", "{i=1}", "i=1\n"] {
        assert_eq!(validate(source).unwrap().len(), 1, "source: {source:?}");
    }
    assert_eq!(validate("i=1").unwrap(), validate("i=1\n\n\n\n").unwrap());
    assert_eq!(apply("i=1", &["i"], None).unwrap(), "");
    assert!(
        apply("id=2", &["id"], Some(&json!(3)))
            .unwrap()
            .contains("\"id\" = 3")
    );
}

#[test]
fn child_paths_beneath_literal_nonobjects_can_be_set_and_unset() {
    for source in ["a=1", "a=null", "a=[1,2]", "a=true", "a=one two", "a += 1"] {
        assert_eq!(apply(source, &["a", "missing"], None).unwrap(), source);
        let edited = apply(source, &["a", "missing"], Some(&json!(3))).unwrap();
        assert!(edited.starts_with(source));
        let resolved: Value = hocon_rs::Config::from(parse(&edited).unwrap())
            .resolve()
            .unwrap();
        assert_eq!(resolved, json!({"a": {"missing": 3}}));
        let removed = apply(&edited, &["a", "missing"], None).unwrap();
        assert_eq!(parse(&removed).unwrap(), parse(source).unwrap());
    }
    assert!(apply("a=${base}", &["a", "missing"], None).is_err());
}

#[test]
fn preserves_unrelated_bytes_and_comments() {
    let source = "# root\ninclude file(\"defaults.conf\")\nwallpaper {\n  duration = 500 // keep this\n  path = \"custom.jpg\"\n}\nother = [1, { x = 2 }]\n";
    let edited = apply(source, &["wallpaper", "duration"], Some(&json!(600))).unwrap();
    assert!(edited.contains("include file(\"defaults.conf\")"));
    assert!(edited.contains("  // keep this\n  path = \"custom.jpg\""));
    assert!(edited.contains("other = [1, { x = 2 }]"));
    assert!(edited.ends_with("\"wallpaper\".\"duration\" = 600\n"));
}

#[test]
fn removes_duplicates_dotted_fields_and_append_assignments() {
    let source = "a { b = [1], c = 3 }\na.b += 2\n\"a\".\"b\" = [4]\na { b = [5] } { b = [6] }\n";
    let edited = apply(source, &["a", "b"], None).unwrap();
    assert!(!edited.contains("b"));
    assert!(edited.contains("c = 3"));
    parse(&edited).unwrap();
}

#[test]
fn handles_root_braces_crlf_and_literal_delimiters() {
    let source = "{\r\n  a = \"\"\"# , { \"quoted\"\n // }\"\"\",\r\n  b = \"#{} //\",\r\n}\r\n";
    let edited = apply(source, &["a"], Some(&json!({"literal.dot": [true, null]}))).unwrap();
    assert!(edited.contains("  b = \"#{} //\",\r\n"));
    assert!(edited.ends_with("  \"a\" = {\"literal.dot\":[true,null]}\r\n}\r\n"));
}

#[test]
fn supports_escaped_and_unicode_keys_without_confusing_literal_dots() {
    let source = "\"a.b\" = 1\na.\"\\u0062\" = 2\n你好 { 世界 = 3 }\n";
    let edited = apply(source, &["a", "b"], None).unwrap();
    assert!(edited.contains("\"a.b\" = 1"));
    assert!(!edited.contains("= 2"));
    let edited = apply(&edited, &["你好", "世界"], None).unwrap();
    assert!(!edited.contains("= 3"));
}

#[test]
fn keeps_comments_inside_removed_objects() {
    let edited = apply(
        "a {\n # explanation\n b = 1 // inline\n}\nx = 2\n",
        &["a"],
        None,
    )
    .unwrap();
    assert!(edited.contains("# explanation"));
    assert!(edited.contains("// inline"));
    assert!(edited.contains("x = 2"));
    parse(&edited).unwrap();
}

#[test]
fn never_removes_nested_includes_or_edits_dynamic_ancestors() {
    assert!(apply("a { include file(\"base.conf\")\nb=2 }", &["a"], None).is_err());
    assert!(apply("a = ${base}", &["a", "b"], Some(&json!(2))).is_err());
    let source = "a { include file(\"base.conf\")\nb=2 }";
    assert!(
        apply(source, &["a", "b"], None)
            .unwrap()
            .contains("include file(\"base.conf\")")
    );
}

#[test]
fn appends_after_late_include_and_preserves_absent_unset() {
    let source = "a=1\ninclude required(file(\"defaults.conf\")) // retained";
    assert_eq!(apply(source, &["missing"], None).unwrap(), source);
    assert!(
        apply(source, &["a"], Some(&json!(2)))
            .unwrap()
            .ends_with("// retained\n\"a\" = 2\n")
    );
}
