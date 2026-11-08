---
name: typescript-argument-design
description: Design or refactor TypeScript and JavaScript parameters in Luna so callers can distinguish inputs without memorizing positional argument order.
---

# TypeScript Argument Design

Follow [AGENTS.md](../../../AGENTS.md) and keep signature changes within the
requested scope.

## Choose the signature

- Keep a single input positional.
- Prefer one named parameter object for multiple independent inputs, especially
  when their types are similar and callers could swap them accidentally.
- A primary value followed by an options object is appropriate when that value
  is the obvious subject and the remaining inputs are optional modifiers.
- Name the parameter-object type when it is non-trivial or part of a public
  contract. Keep a small, one-use shape inline when a name adds no clarity.
- Avoid wrapping one value in an object or adding options merely for possible
  future use.

## Preserve external contracts

Keep signatures required by libraries, runtime callbacks, and QML or native
bridges. Convert to an application-owned parameter object only where it improves
the deeper API; do not change external argument order to impose this style.

## Update callers together

- Inspect every in-scope caller before changing a signature and update them
  together. Preserve optional values, defaults, and error behavior.
- Do not add compatibility overloads or wrappers solely to retain the old
  positional form.
- Use [code-comments](../code-comments/SKILL.md) for caller-relevant contracts.
  Verify affected callers with the owning package's documented type checks and
  existing tests; add regression coverage when behavior changes.

Adapted from the `typescript-argument-design` skill in
[jrTilak/lazy-wallet](https://github.com/jrTilak/lazy-wallet).
