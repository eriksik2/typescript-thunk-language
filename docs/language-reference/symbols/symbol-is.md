# Symbol.is / Symbol.extends

## What it is

Hierarchical tests over branded values and symbol identities.

```ts
import { Symbol } from "@thunk/runtime"

Symbol.is(value, Failure)      // value branded with Failure or a descendant
Symbol.extends(Defect, Failure) // Defect identity extends Failure
Symbol.of(value)               // most-specific (leaf) identity only
```

## Rules

- `Symbol.of` always returns the **leaf** identity stamped at brand time.
- `Symbol.is(value, Parent)` walks the declaration-time parent chain.
- Abstract parents work: `Symbol.is(defect, Failure)` when `Failure` is abstract.
- Does **not** change `Requires` / env Map lookup (still exact keys).

## Related

- [Symbol.of](./symbol-of.md)
- [symbol declarations](./symbol-declarations.md)
- [Failure hierarchy](./failure-hierarchy.md)
- [Branding](./branding.md)
