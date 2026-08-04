# Symbol.of

## What it is

Recover the symbol **identity** from a branded inhabitant.

```ts
import { Symbol, symbolOf } from "@thunk/runtime"

const DatabaseLive = Database({ name: "live" })
Symbol.of(DatabaseLive)   // Database
symbolOf(DatabaseLive)    // same
```

## Rules

- Works for values branded via `Name(...)` when the associated value is an **object** (identity is stamped at brand time).
- Throws if the value does not carry an identity (e.g. naked primitives).
- Type-level: `SymbolOfValue<typeof DatabaseLive>` is `typeof Database`.

## Why it exists

[`provide(thunk, DatabaseLive)`](../environment/provide.md) needs the env **key**. Branding retains identity so you do not repeat `layerOf(Database, DatabaseLive)` for the common case.

## Related

- [Branding](./branding.md)
- [provide](../environment/provide.md)
- [layer](../environment/layer.md)
- [Runtime packages](../modules/runtime-packages.md)
