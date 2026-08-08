# is (pattern test)

## What it is

`scrutinee is Pattern` is a **boolean** expression: exact leaf test (same as [`match`](./match.md) / `Symbol.is`).

`scrutinee is any Pattern` is a **pedigree** test (`Symbol.isAny`) — true when the leaf is the symbol or extends it. Else-branch narrowing excludes those arms from the union (TS `typeof`-style).

With `infer` bindings, either form is only legal in **`if` / `while` conditions** (including `&&` chains). Bindings are in scope in later conjuncts and the then-branch / loop body.

## Syntax

```ts
value is NotFound
value is NotFound: infer e
value is any Error
value is any Error: infer e
value is any NotFound { path: infer p }

const describe = (r: number | AppErr) => thunk {
  if (r is any Error: infer e) {
    return "err " + e.message
  }
  if (r > 0) {
    return "pos " + r
  }
  return "other"
}

const flag = value is any Error    // ok — no bindings
// const bad = value is any Error: infer e  // error — bindings need if/while
```

`if` / `while` with `is` bindings should live in `thunk { … }` (or other Thunk-parsed statement contexts). Opaque TypeScript `() => { … }` blocks are not walked for Thunk syntax.
Patterns are the same as match v1 (`Symbol`, `Symbol: infer x`, `Symbol { f: infer x }`), optionally prefixed with `any`.

## Semantics

| Form | Result |
|---|---|
| `x is S` | `boolean` (`Symbol.is(x, S)`) — exact leaf |
| `x is any S` | `boolean` (`Symbol.isAny(x, S)`) — pedigree |
| `x is S: infer v` / `x is any S: infer v` in `if`/`while` | on success, bind payload `v` in the success region |
| `a && (x is S: infer v)` | `is` binds tighter than `&&`; `v` visible in later conjuncts and then-branch |

## Examples

[`examples/is-pattern.thunk`](../../../examples/is-pattern.thunk)

## Related

- [match](./match.md) — multi-arm exhaustive match (exact leaves only)
- [try](./try.md) — uses `is any Error` under the hood
- [Fallibility](../types/fallibility.md)
- [control flow](./control-flow.md)
- [Symbol.is / isAny](../symbols/symbol-is.md)
