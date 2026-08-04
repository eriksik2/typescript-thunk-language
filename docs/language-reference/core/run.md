# run

## What it is

`run` is **syntax**, not a runtime import. Think of it like **`await` for thunks**: it peels one `Thunk` layer and continues with the yielded value.

| Position | Meaning |
|---|---|
| Inside a `thunk` body (statement) | Suspend the state machine: run the operand, resume with its value |
| `return run expr` | Suspend, then succeed with the resumed value |
| Top level | Execute a thunk to a value (`execute`) |

## Syntax

```ts
const value = run someThunk
const user = run db.getUser("1234")   // full expression operand
return run provide(fetchUser, db)
run program
```

The operand is a **full expression** (identifier, call, member access, nested `thunk { … }`, …) — same idea as `await expr`.

## Semantics

- Inside thunks → lowers to an iterative switch-based state machine: `runEffect(operand)` suspends; resume assigns the binding and continues at the next state.
- `return run expr` → `runEffect(expr)` then `succeed(__resume)`.
- At top level → lowers to `execute(operand)`.
- Each `run` removes **one** thunk layer (no auto-flatten).

`run` is still restricted to **statement** positions (`const x = run …`, bare `run …`, `return run …`) — not inside arbitrary expressions like `foo(run bar)`.

`try` / `catch` / `finally` are **out of scope** for now (handler/finalizer state is a separate design).

## Examples

```ts
const program = thunk {
  const value = run random
  return value * 2
}

const fetchUser = thunk {
  const db = run use(Database)
  const user = run db.getUser("1234")
  return user.name
}

const result = run program
```

See [`examples/basic.thunk`](../../../examples/basic.thunk) and [`examples/requires.thunk`](../../../examples/requires.thunk).

## Related

- [Thunk blocks](./thunk-blocks.md)
- [Control flow](./control-flow.md) — `if` / loops with `run` become state transitions
- [use](../environment/use.md) — often combined as `run use(Database)`
- [provide](../environment/provide.md)
- [Runtime packages](../modules/runtime-packages.md) — `machine` / `runEffect` / `execute` live in `/internal`
