# Thunk type

## What it is

`Thunk<T>` is the type of a deferred computation that yields `T`.  
With protocols: conceptually `Thunk<T> Requires(…)`; encoded as `Thunk<T, ProtocolBag>`.

## Auto-available

Authors **do not** import `Thunk`. The lowerer injects:

```ts
import type { Thunk } from "@thunk/types"
```

when annotations need it.

## Syntax

```ts
const program: Thunk<string> = provide(fetchUser, DatabaseLive)

const asyncOp: Thunk<number> Async = wrap(() => Promise.resolve(1))

const fetchUser: Thunk<string> Requires(Database) = thunk {
  const db = run use(Database)
  return db.name
}
```

Empty bags pretty-print as `Thunk<T>` (not `Thunk<T, EmptyProtocols>`).  
Nested thunks pretty-print compactly: `Thunk<Thunk<boolean> Async>`.

## Assignability

Protocol bags are **invariant** in the TypeScript encoding. A thunk that carries
`Requires(…)` or `Async` is **not** assignable to plain `Thunk<T>` — that would
silently drop requirements or turn a `Promise`-returning execute into a sync `T`.

```ts
const withDb: Thunk<string> Requires(Database) = fetchUser
const pure: Thunk<string> = withDb        // error
const sync: Thunk<number> = asyncOp       // error
const okAsync: Thunk<number> Async = asyncOp  // ok
```

After `provide` discharges requirements, the result may be annotated `Thunk<T>`.

## Related

- [Protocols overview](./protocols-overview.md)
- [Requires](./requires.md)
- [Async](./async.md)
- [Thunk blocks](../core/thunk-blocks.md)
- [Runtime packages](../modules/runtime-packages.md)
