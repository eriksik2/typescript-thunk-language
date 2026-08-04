# Control flow

## What it is

Inside `thunk` bodies you can write familiar imperative control flow: `if` / `else`, `while`, C-style `for`, `break`, `continue`, blocks, and early `return`.

When the body also uses [`run`](./run.md), the lowerer compiles the body to an **iterative switch-based state machine**. Branches and loops become state transitions (`__state = next; continue`); each `run` suspends with `runEffect` and resumes at the next state.

## Syntax

```ts
thunk {
  if (x > 0) {
    return x
  } else if (x === 0) {
    return 0
  } else {
    return -x
  }
}

thunk {
  for (let i = 0; i < n; i = i + 1) {
    const v = run step(i)
    if (v === 0) continue
    if (v > cap) break
    total = total + v
  }
  return total
}
```

## Semantics

- Pure control flow (no `run`) stays as ordinary JS inside `defer(() => …)`.
- With `run`, control flow is explicit states in `machine(step)`.
- `break` / `continue` target the enclosing loop’s exit / continue states.
- **`try` / `catch` / `finally` are not supported yet** (handler/finalizer state is a separate design).

## Examples

See [`examples/control-flow.thunk`](../../../examples/control-flow.thunk) (and its compiled sibling `examples/control-flow.thunk.ts`).

## Related

- [Thunk blocks](./thunk-blocks.md)
- [run](./run.md)
- [Bindings](./bindings.md)
