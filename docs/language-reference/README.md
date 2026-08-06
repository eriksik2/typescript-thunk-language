# Thunk language reference

Browseable reference for language features: what they are, how they work, examples, and links to related pages.

Prefer this folder when you need **how a feature works**.  
[`../LANGUAGE.md`](../LANGUAGE.md) remains the long-form design essay.  
[`../FEATURES.md`](../FEATURES.md) is implementation status.  
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) is the compiler/editor pipeline.

## Start here

| I want… | Go to |
|---|---|
| Overview of the language | [Core concepts](./core/README.md) |
| `thunk { }` / `run` / `\|` / `match` / `is` | [Thunk blocks](./core/thunk-blocks.md), [run](./core/run.md), [pipe](./core/pipe.md), [match](./core/match.md), [is](./core/is.md) |
| `Thunk<T>` types & protocols | [Types](./types/README.md) |
| `symbol` / branding / `Symbol.of` | [Symbols](./symbols/README.md) |
| `use` / `provide` / layers | [Environment](./environment/README.md) |
| Imports & packages | [Modules](./modules/README.md) |
| CLI & editor | [Tooling](./tooling/README.md) |
| A–Z list of pages | [Alphabetical index](./INDEX.md) |

## Sections

- [**core/**](./core/README.md) — syntax kernel (`thunk`, `run`, `|`, `match`, bindings)
- [**types/**](./types/README.md) — `Thunk<T>`, protocols, `Requires`
- [**symbols/**](./symbols/README.md) — `symbol` declarations, branding, `Symbol.of`
- [**environment/**](./environment/README.md) — `use`, `provide`, layers
- [**modules/**](./modules/README.md) — file prelude, imports, `@thunk/runtime` vs `/internal`
- [**tooling/**](./tooling/README.md) — `thunk build` / `thunk run`, editor

## Examples in the repo

| Example | Features |
|---|---|
| [`examples/basic.thunk`](../../examples/basic.thunk) | `thunk` / `run` |
| [`examples/pipe.thunk`](../../examples/pipe.thunk) | `\|` pipe + expr-position `run` |
| [`examples/match.thunk`](../../examples/match.thunk) | `match` / Result / Option / error union |
| [`examples/is-pattern.thunk`](../../examples/is-pattern.thunk) | `if (x is Err: infer e)` |
| [`examples/symbols.thunk`](../../examples/symbols.thunk) | branding |
| [`examples/symbols-hierarchy.thunk`](../../examples/symbols-hierarchy.thunk) | `abstract` / `extends` |
| [`examples/failures.thunk`](../../examples/failures.thunk) | built-in Failure tree + `Symbol.is` |
| [`examples/async-wrap.thunk`](../../examples/async-wrap.thunk) | `wrap` / `Async` |
| [`examples/requires.thunk`](../../examples/requires.thunk) | `symbol` + `use` / `provide` |
