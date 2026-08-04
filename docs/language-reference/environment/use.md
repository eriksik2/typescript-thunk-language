# use

## What it is

Read a service from the current environment.

```ts
import { use } from "@thunk/runtime"

const db = run use(Database)
```

## Type

```ts
use(Database): Thunk<SymbolType<typeof Database>> Requires(Database)
```

- Yield is the associated type (`{ name: string }` for `Database`).
- Introduces [`Requires(Database)`](../types/requires.md) (identity key).

Must be **imported** from `@thunk/runtime`.

## Related

- [provide](./provide.md)
- [symbol declarations](../symbols/symbol-declarations.md)
- [run](../core/run.md)
- [Imports](../modules/imports.md)
