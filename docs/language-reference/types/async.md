# Async protocol

## What it is

Flag protocol on a thunk meaning the computation may wait on the event loop (Promise / timers / I/O via [`wrap`](../core/wrap.md)).

Not discharged by `provide` — it only changes what outer [`execute`](../modules/runtime-packages.md) / top-level `run` returns.

## Surface

```ts
import { wrap } from "@thunk/runtime"

const program = thunk {
  const n = run wrap(() => Promise.resolve(1))
  return n + 1
}

// inferred: Thunk<number> Async
const result: Promise<number> = run program
```

Annotation form:

```ts
const t: Thunk<number> Async = wrap(() => Promise.resolve(1))
```

## Semantics

| Op | Behavior |
|---|---|
| `succeed` | no `Async` |
| `wrap` | introduces `Async` |
| `bind` / machine merge | present if **either** side has it |
| `execute` / top-level `run` | absent → `T`; present → `Promise<T>` |

`Requires` still wins for validity: unsatisfied requirements → `CompileError` even if `Async` is present.

A thunk carrying `Async` is **not** assignable to plain `Thunk<T>` (protocol bags are invariant). Annotate with postfix `Async` when the async flag must be preserved.

## Related

- [wrap](../core/wrap.md)
- [run](../core/run.md)
- [Protocols overview](./protocols-overview.md)
- [Requires](./requires.md)
- [Thunk type](./thunk-type.md)
- [Failure hierarchy](../symbols/failure-hierarchy.md) — rejections → `UnhandledError`
