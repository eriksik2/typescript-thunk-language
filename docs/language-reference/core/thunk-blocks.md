# Thunk blocks

## What it is

`thunk { … }` builds a **Thunk** value: a deferred computation. The body does not run when the thunk is constructed; it runs when executed (`run` at top level, or as part of a larger program).

## Syntax

```ts
const program = thunk {
  return 1 + 1
}
```

`thunk { … }` is an **expression**. It may appear anywhere an expression is legal — const initializers, `return`, call arguments, object/array literals, arrow bodies:

```ts
const DatabaseLive = Database({
  name: "live",
  getUser: (id: string) => thunk {
    return { id, name: "Ada" }
  },
})
```

Body statements may include ordinary bindings, nested thunks, [`run`](./run.md) in statement position, and [control flow](./control-flow.md) (`if` / `while` / `for` / `break` / `continue`).

## Semantics

- Pure bodies lower to `defer(() => succeed(…))`.
- Bodies with `run` lower to `defer(() => { …; return machine(step) })` — an iterative switch-based state machine using `runEffect` / `succeed`.
- Yield type is the type of the `return` expression (or `void`).
- Pure thunks have an empty protocol bag → surface type `Thunk<T>`.
- Nested `thunk { … }` inside ordinary TypeScript text (calls, objects, arrows) is still parsed and lowered — not left as raw `thunk` for TypeScript.

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

See [`examples/basic.thunk`](../../../examples/basic.thunk) and nested usage in [`examples/requires.thunk`](../../../examples/requires.thunk).

## Related

- [run](./run.md)
- [Control flow](./control-flow.md)
- [Thunk type](../types/thunk-type.md)
- [Bindings](./bindings.md)
