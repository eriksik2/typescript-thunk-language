# try

## What it is

Inside a `thunk { … }`, `try expr` runs a thunk and **propagates** Error-pedigree
arms to the enclosing yield via early return. Success arms continue as the
expression value.

```ts
const n = try div   // n is the non-Error part of div's yield
```

Desugars roughly to:

```ts
const __try = run div
if (__try is any Error) return __try
// continue with success arms
```

## Rules

| | |
|---|---|
| Only inside `thunk { … }` | Top-level `try` is an error |
| Operand | Same as `run` (a thunk expression) |
| Error test | `is any Error` (pedigree under [`Error`](../symbols/failure-hierarchy.md)) |
| Not | JS `try` / `catch` / `finally` |

## Example

[`examples/try-errors.thunk`](../../../examples/try-errors.thunk)

## Related

- [Fallibility](../types/fallibility.md)
- [`run`](./run.md)
- [`is`](./is.md) (`is any`)
- [control flow](./control-flow.md) — `catch` / `finally` still deferred
