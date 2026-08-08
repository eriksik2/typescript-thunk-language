# Oracle typecheck view

## What it is

Effectful `thunk { … }` bodies (those that use [`run`](../core/run.md)) lower to
**two** TypeScript projections of the same AST:

1. **Oracle** — structure-preserving `async () => { … await __oracleRun(e) … }`
2. **Runtime** — iterative `machine` / `runEffect` state machine (as before)

They are linked with `__ascribeThunkYield(oracle, defer(() => machine(…)))`:

- Yield **`T`** comes from the oracle (`Awaited<ReturnType<typeof oracle>>`) —
  the same control-flow analysis TypeScript applies to an equivalent async
  function (`run` ↔ `await`).
- Protocol bag **`P`** (`Requires`, `Async`, …) still comes from the machine.

Pure thunks (no `run`) stay a single `defer(() => succeed(…))` path.

## Why

Machine lowering hoists locals and flattens control flow into `switch (__state)`.
That shape loses TypeScript’s CFA, so yield types used to widen (e.g.
`Thunk<number | void> Async` for a `while (true)` that always `return`s a
`number`). The oracle restores 1:1 value-level inference without teaching `tsc`
to understand state machines.

## Drift rules

When adding thunk-body surface syntax:

1. Extend **both** emitters (oracle statement/value emit and machine/CFG) — or
   ensure ANF desugars the feature to forms both already handle (`run` / `is` /
   ordinary statements).
2. Add a case under `packages/language-service/surface-oracle.test.ts`.
3. Keep `bun run test` green; examples that emit `runEffect` must also emit
   `__ascribeThunkYield`.

## Related

- [Thunk blocks](../core/thunk-blocks.md)
- [Control flow](../core/control-flow.md)
- [run](../core/run.md)
- [Architecture](../../ARCHITECTURE.md)
- [`examples/async-wrap.thunk`](../../../examples/async-wrap.thunk)
