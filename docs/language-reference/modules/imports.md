# Imports

## What it is

`.thunk` files use ES-style named imports. Value APIs are **not** ambient.

```ts
import { use, provide } from "@thunk/runtime"
```

Also supported: `import type { … } from "…"`, `type` on individual specifiers, `as` aliases.

## Auto vs explicit

| Name | Import? |
|---|---|
| `Thunk` (type) | Auto — lowerer injects from `@thunk/types` |
| `use` / `provide` / `layerOf` / `mergeLayers` / `Symbol` / `symbolOf` | Explicit from `@thunk/runtime` |
| `succeed` / `defer` / `bind` / `execute` / `__makeSymbol` | Never in author code — `/internal` only |

Missing `use` → TypeScript “Cannot find name 'use'”.

## Related

- [File prelude](./file-prelude.md) — required before imports
- [Runtime packages](./runtime-packages.md)
- [use](../environment/use.md)
- [Thunk type](../types/thunk-type.md)
