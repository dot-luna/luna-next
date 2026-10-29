use super::*;

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
