# match

## What it is

`match` is **exact leaf** pattern matching over branded symbol values. Exhaustiveness is checked by TypeScript: uncovered union members make the final `__exhaustive` call a type error.

Hierarchy (`extends` / `Symbol.has`) is **not** used for arms — parents do not close open taxonomies. Closed sets are ordinary unions of **leaves**.

## Syntax (v1)

```ts
match (value) {
  Ok: infer a => a,
  Err: infer e => handle(e),
  None => 0,
  Circle { radius: infer r } => r,
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
- Each arm uses runtime `Symbol.is` (exact leaf), never `Symbol.has`.
- Payload bindings unwrap boxed primitives (so `Ok(42)` / `Some(1)` work).
- If no arm matches at runtime → throw. If arms are incomplete for the static type → **compile error** (`never`).

## Result / Option

Built-in Result:

```ts
import { Ok, Err, type Result } from "@thunk/runtime"

symbol Some<T> = T
symbol None = {}
type Option<T> = Some<T> | None
```

`Ok` / `Err` are generic symbols (`symbol Ok<A> = A`). See [`result.md`](../types/result.md).

## Examples

[`examples/match.thunk`](../../../examples/match.thunk) — Result, Option, shape union, closed error union (`NotFound \| Conflict`).

## Related

- [is](./is.md) — single-arm boolean test + `if`/`while` bindings
- [Result](../types/result.md)
- [symbol declarations](../symbols/symbol-declarations.md) — including generics
- [Symbol.is / has / to](../symbols/symbol-is.md)
- [Failure hierarchy](../symbols/failure-hierarchy.md) — open taxonomy; exhaustiveness uses leaf unions
