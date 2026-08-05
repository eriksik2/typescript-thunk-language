# is (pattern test)

## What it is

`scrutinee is Pattern` is a **boolean** expression: exact leaf test (same as [`match`](./match.md) / `Symbol.is`).

With `infer` bindings, it is only legal in **`if` / `while` conditions** (including `&&` chains). Bindings are in scope in later conjuncts and the then-branch / loop body.

## Syntax

```ts
value is Err
value is Err: infer e
value is Circle { radius: infer r }

const describe = (r: Result<number, string>) => thunk {
  if (value is Err: infer e) {
    return use(e)
  }
  if (ready && value is Ok: infer n && n > 0) {
    return use(n)
  }
  return "other"
}

while (cursor is Some: infer x) {
  // x in body
}

const flag = value is Err    // ok — no bindings
// const bad = value is Err: infer e  // error — bindings need if/while
```

`if` / `while` with `is` bindings should live in `thunk { … }` (or other Thunk-parsed statement contexts). Opaque TypeScript `() => { … }` blocks are not walked for Thunk syntax.
Patterns are the same as match v1 (`Symbol`, `Symbol: infer x`, `Symbol { f: infer x }`).

## Semantics

| Form | Result |
|---|---|
| `x is S` | `boolean` (`Symbol.is(x, S)`) |
| `x is S: infer v` in `if`/`while` | on success, bind payload `v` in the success region |
| `a && (x is S: infer v)` | `is` binds tighter than `&&`; `v` visible in later conjuncts and then-branch |

Ancestor / `Symbol.has` patterns are out of scope for v1.

## Examples

[`examples/is-pattern.thunk`](../../../examples/is-pattern.thunk)

## Related

- [match](./match.md) — multi-arm exhaustive match
- [control flow](./control-flow.md)
- [Result](../types/result.md)
- [Symbol.is / has / to](../symbols/symbol-is.md)
