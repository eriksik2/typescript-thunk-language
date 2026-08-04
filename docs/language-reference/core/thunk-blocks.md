# Thunk blocks

## What it is

`thunk { … }` builds a **Thunk** value: a deferred computation. The body does not run when the thunk is constructed; it runs when executed (`run` at top level, or as part of a larger program).

## Syntax

```ts
const program = thunk {
  return 1 + 1
}
```

Body statements may include ordinary bindings, nested thunks, and [`run`](./run.md) in statement position.

## Semantics

- Lowers to `defer(() => …)` with `succeed` / `bind` for control flow.
- Yield type is the type of the `return` expression (or `void`).
- Pure thunks have an empty protocol bag → surface type `Thunk<T>`.

## Examples

```ts
const random = thunk {
  return Math.random()
}

const program = thunk {
  const value = run random
  return value * 2
}
```

See [`examples/basic.thunk`](../../../examples/basic.thunk).

## Related

- [run](./run.md)
- [Thunk type](../types/thunk-type.md)
- [Bindings](./bindings.md)
