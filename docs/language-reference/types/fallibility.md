# Fallibility (`Fail`)

## What it is

Fallibility is part of the **thunk type**, written before protocols:

```ts
Thunk<number> Fail(DivideByZero)
Thunk<User> Fail(NotFound | Conflict) Requires(Database)
```

`Fail(E)` means success yield `T` with error arms `E` (typically leaves under
[`Error`](../symbols/failure-hierarchy.md)). It encodes as yield `T | E` — not a
protocol bag entry.

```ts
symbol DivideByZero extends Error {}

const div = (a: number, b: number): Thunk<number> Fail(DivideByZero) => thunk {
  return b === 0 ? DivideByZero({ message: "divide by zero" }) : a / b
}
```

You can also write the union yourself (`Thunk<number | DivideByZero>`); `|` inside
type arguments is a **union**, not pipe.

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

const propagate = (a: number, b: number): Thunk<number> Fail(DivideByZero) => thunk {
  const n = try div(a, b)
  return n + 1
}
```

`try` is sugar for run + `if (… is any Error) return …`. It is **not** JS
`try` / `catch` / `finally`.

## Discrimination

- Exact leaf: `res is DivideByZero` / `match`
- Pedigree: `res is any Error` → [`Symbol.isAny`](../symbols/symbol-is.md)

## Related

- [`try`](../core/try.md)
- [`is`](../core/is.md) / [`match`](../core/match.md)
- [Failure hierarchy](../symbols/failure-hierarchy.md)
- [`examples/try-errors.thunk`](../../../examples/try-errors.thunk)
