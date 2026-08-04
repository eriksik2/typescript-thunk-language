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
```

Empty bags pretty-print as `Thunk<T>` (not `Thunk<T, EmptyProtocols>`).

## Related

- [Protocols overview](./protocols-overview.md)
- [Requires](./requires.md)
- [Thunk blocks](../core/thunk-blocks.md)
- [Runtime packages](../modules/runtime-packages.md)
