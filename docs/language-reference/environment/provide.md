# provide

## What it is

Run a thunk with additional environment entries; removes the provided identities from `Requires`.

## Forms

### Branded object (preferred for single services)

```ts
import { use, provide } from "@thunk/runtime"

const DatabaseLive = Database({ name: "live" })

const program: Thunk<string> = provide(
  fetchUser,
  DatabaseLive,
)
```

Uses [`Symbol.of`](../symbols/symbol-of.md) internally to find the key.

### Layer

```ts
import { provide, layerOf } from "@thunk/runtime"

provide(fetchUser, layerOf(Database, { name: "live" }))
```

Use layers for merges, primitives, or when you do not have a branded object.

## Related

- [use](./use.md)
- [Layer](./layer.md)
- [Branding](../symbols/branding.md)
- [Symbol.of](../symbols/symbol-of.md)
- [Requires](../types/requires.md)

See [`examples/requires.thunk`](../../../examples/requires.thunk).
