# run

## What it is

`run` is **syntax**, not a runtime import.

| Position | Meaning |
|---|---|
| Inside a `thunk` body (statement) | Sequence: wait for the operand thunk, bind the result |
| Top level | Execute a thunk to a value (`execute`) |

## Syntax

```ts
const value = run someThunk
run program
```

## Semantics

- Inside thunks → lowers to `bind(operand, value => …)`.
- At top level → lowers to `execute(operand)`.
- Operand may be an identifier or a call expression (`run use(Database)`).

## Examples

```ts
const program = thunk {
  const value = run random
  return value * 2
}

const result = run program
```

## Related

- [Thunk blocks](./thunk-blocks.md)
- [use](../environment/use.md) — often combined as `run use(Database)`
- [Runtime packages](../modules/runtime-packages.md) — `execute` lives in `/internal`
