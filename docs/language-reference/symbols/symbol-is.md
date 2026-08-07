# Symbol.is / Symbol.isAny / Symbol.to / Symbol.extends

## What it is

Operations over branded values and symbol identities. Hierarchy is **pedigree**, not value subtyping.

```ts
import { Symbol } from "@thunk/runtime"

Symbol.of(value)              // leaf identity
Symbol.is(value, Cat)         // exact — of(value) === Cat
Symbol.isAny(value, Animal)   // leaf or ancestor
Symbol.to(value, Animal)      // checked upcast along ancestry
Symbol.extends(Cat, Animal)   // identity-level ancestry (no value)
```

## Rules

| Op | Meaning |
|---|---|
| `of` | Most-specific (leaf) identity stamped at brand time |
| `is` | Exact leaf match only |
| `isAny` | Walks declaration-time parent chain |
| `to` | Requires `isAny`; returns same object typed toward the ancestor; does **not** re-stamp (`of` stays leaf). Wrong target → type error; runtime → `Defect` |
| `extends` | `child` identity is `parent` or extends it |

Child branded types are **not** assignable to parent types:

```ts
const cat = Cat({ name: "Misty" })
// const bad: Animal = cat          // error
const a = Symbol.to(cat, Animal)   // ok
Symbol.is(cat, Animal)             // false
Symbol.isAny(cat, Animal)          // true
```

Surface patterns: `x is Foo` ↔ `Symbol.is`; `x is any Foo` ↔ `Symbol.isAny`.

`Requires` / env Map lookup stays **exact** (not subtype-aware).

## Related

- [Symbol.of](./symbol-of.md)
- [symbol declarations](./symbol-declarations.md)
- [Failure hierarchy](./failure-hierarchy.md)
- [Branding](./branding.md)
- [`is` patterns](../core/is.md)
