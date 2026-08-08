# match

## What it is

`match` is **exact leaf** pattern matching over branded symbol values. Exhaustiveness is checked by TypeScript: uncovered union members make the final `__exhaustive` call a type error.

Hierarchy (`extends` / `Symbol.isAny`) is **not** used for arms — parents do not close open taxonomies. Closed sets are ordinary unions of **leaves**. Use [`is any`](./is.md) for pedigree tests outside match.

## Syntax (v1)

```ts
match (value) {
  Some: infer a => a,
  None => 0,
  Circle { radius: infer r } => r,
  NotFound { path: infer p } => p,
}
```

| Pattern | Meaning |
|---|---|
| `Symbol => expr` | Exact `Symbol.is`; no binding |
| `Symbol: infer x => expr` | Exact match; `x` is the associated payload |
| `Symbol { f: infer x, … } => expr` | Exact match; bind listed fields |

Arms may be separated by commas and/or newlines. `run` inside arms is **not** allowed in v1 (bind with a statement `run` first).

## Semantics

- Scrutinee is evaluated once.
- Each arm uses runtime `Symbol.is` (exact leaf), never `Symbol.isAny`.
- Payload bindings unwrap boxed primitives (so `Some(1)` works).
- If no arm matches at runtime → throw. If arms are incomplete for the static type → **compile error** (`never`).

## Option / error unions

```ts
symbol Some<T> = T
symbol None = {}
type Option<T> = Some<T> | None

symbol NotFound extends Error { path: string }
symbol Conflict extends Error { resource: string }
type AppErr = NotFound | Conflict
```

Fallible thunks use Error-subtype unions — see [Fallibility](../types/fallibility.md). There is no built-in `Ok` / `Err` / `Result`.

## Examples

[`examples/match.thunk`](../../../examples/match.thunk) — Option, shape union, closed error union (`NotFound \| Conflict`).

## Related

- [is](./is.md) — single-arm boolean test + `is any` pedigree
- [Fallibility](../types/fallibility.md)
- [symbol declarations](../symbols/symbol-declarations.md) — including generics
- [Symbol.is / isAny](../symbols/symbol-is.md)
- [Failure hierarchy](../symbols/failure-hierarchy.md) — open taxonomy; exhaustiveness uses leaf unions
