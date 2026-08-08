# Core

The syntax kernel shared by almost every program.

## Pages

| Feature | Summary |
|---|---|
| [Thunk blocks](./thunk-blocks.md) | `thunk { … }` builds a deferred computation |
| [run](./run.md) | `run expr` sequences / executes thunks (ANF for expr position) |
| [try](./try.md) | Inside thunk: run + early-return on Error arms |
| [Pipe](./pipe.md) | `\|` first-arg call sugar; tighter than `run` |
| [match](./match.md) | Exact leaf pattern match + exhaustiveness |
| [is](./is.md) | `expr is` / `is any` pattern test + `if`/`while` binds |
| [wrap](./wrap.md) | Promise → `Thunk` (`Async`) |
| [Bindings](./bindings.md) | `const` / `let` in thunk bodies and at top level |
| [Control flow](./control-flow.md) | `if` / `while` / `for` / `break` / `continue` → state machine |

## Related

- [Thunk type](../types/thunk-type.md) — the type of a thunk value
- [Fallibility](../types/fallibility.md) — Error unions + try
- [Async](../types/async.md) — when top-level `run` returns `Promise`
- [Imports](../modules/imports.md) — what must be imported
