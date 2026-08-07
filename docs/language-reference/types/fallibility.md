# Fallibility (Error unions)

## What it is

There is **no** `Result` / `Ok` / `Err` wrapper. Fallibility is a plain union whose
error arms extend [`Error`](../symbols/failure-hierarchy.md):

```ts
symbol DivideByZero extends Error {}
type DivResult = number | DivideByZero

const div = (a: number, b: number): Thunk<DivResult> => thunk {
  return b === 0 ? DivideByZero({ message: "divide by zero" }) : a / b
}
```

Success stays in the yield type. Failure leaves are ordinary symbols under `Error`.

## `run` vs `try`

| Form | Meaning |
|---|---|
| `run div` | Peel one thunk layer → `number \| DivideByZero` (handle locally) |
| `try div` | Inside a thunk: run, early-return Error arms, continue with success arms |

```ts
const safe = (a: number, b: number): Thunk<number> => thunk {
  const res = run div(a, b)
  if (res is DivideByZero) return 0
  return res as number
}

const propagate = (a: number, b: number): Thunk<DivResult> => thunk {
  const n = try div(a, b)
  return n + 1
}
```

`try` is sugar for run + `if (… is any Error) return …` (plus a narrowing helper for
state-machine emit). It is **not** JS `try` / `catch` / `finally`.

## Discrimination

- Exact leaf: `res is DivideByZero` / `match`
- Pedigree: `res is any Error` → [`Symbol.isAny`](../symbols/symbol-is.md)

## Related

- [`try`](../core/try.md)
- [`is`](../core/is.md) / [`match`](../core/match.md)
- [Failure hierarchy](../symbols/failure-hierarchy.md)
- [`examples/try-errors.thunk`](../../../examples/try-errors.thunk)

**Not in this wave:** `Thunk<T> Fail(E)` pretty spelling / Fail protocol.
