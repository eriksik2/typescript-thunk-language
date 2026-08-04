# symbol declarations

## What it is

A `symbol` declaration introduces **one value** and **one nominal type** with the same name.

| Form | Associated type `T` |
|---|---|
| `symbol Age = number` | `number` |
| `symbol Database { name: string }` | `{ name: string }` (sugar for `= { … }`) |
| `abstract symbol Failure { message: string }` | same, but identity is **not** a brand constructor |
| `symbol Defect extends Failure` | inherits parent associated type (payload merge) |
| `symbol Dog extends Animal { breed: string }` | parent assoc **merged** with extra fields |

## Semantics

1. **Value** `Name` — identity typed by `T`; callable for [branding](./branding.md) unless `abstract`; has `.key` for the env map.
2. **Type** `Name` — branded inhabitants (nominal over `T`). Child types are **not** subtypes of parents.
3. `Name` → `T` assignable; `T` → `Name` only via `Name(...)` (concrete symbols).
4. Env APIs take the **value** `Name` (`use` / `layerOf`) or a branded object ([`provide`](../environment/provide.md)).
5. **`extends`** — identity pedigree for [`Symbol.has`](./symbol-is.md) / `Symbol.to` / `Symbol.extends`. Associated type fields merge; **no** value Liskov assignability.
6. **`abstract`** — cannot call `Name(...)` to brand; still usable as a type, parent, and `Symbol.has` / `Symbol.to` target.

Anonymous `symbol { }` in expressions is out of scope.

## Examples

```ts
symbol Age = number

symbol Database {
  name: string
}

abstract symbol Animal {
  name: string
}

symbol Dog extends Animal {
  breed: string
}

symbol Cat extends Animal

const cat = Cat({ name: "Misty" })
// const bad: Animal = cat              // error
const a = Symbol.to(cat, Animal)        // ok
```

See [`examples/symbols.thunk`](../../../examples/symbols.thunk), [`examples/symbols-hierarchy.thunk`](../../../examples/symbols-hierarchy.thunk), [`examples/failures.thunk`](../../../examples/failures.thunk).

## Related

- [Branding](./branding.md)
- [Symbol.of](./symbol-of.md)
- [Symbol.is / has / to](./symbol-is.md)
- [Failure hierarchy](./failure-hierarchy.md)
- [Requires](../types/requires.md)
