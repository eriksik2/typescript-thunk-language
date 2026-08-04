# symbol declarations

## What it is

A `symbol` declaration introduces **one value** and **one nominal type** with the same name.

| Form | Associated type `T` |
|---|---|
| `symbol Age = number` | `number` |
| `symbol Database { name: string }` | `{ name: string }` (sugar for `= { … }`) |
| `abstract symbol Failure { message: string }` | same, but identity is **not** a brand constructor |
| `symbol Defect extends Failure` | inherits parent associated type |
| `symbol Dog extends Animal { breed: string }` | parent assoc **merged** with extra fields |

## Semantics

1. **Value** `Name` — identity typed by `T`; callable for [branding](./branding.md) unless `abstract`; has `.key` for the env map.
2. **Type** `Name` — branded inhabitants (nominal over `T`).
3. `Name` → `T` assignable; `T` → `Name` only via `Name(...)` (concrete symbols).
4. Env APIs take the **value** `Name` (`use` / `layerOf`) or a branded object ([`provide`](../environment/provide.md)).
5. **`extends`** — child branded type is a subtype of the parent (Liskov). Runtime parent link enables [`Symbol.is`](./symbol-is.md) / `Symbol.extends`. Env `Requires` lookup stays **exact** (not subtype-aware).
6. **`abstract`** — cannot call `Name(...)` to brand; still usable as a type, parent, and `Symbol.is` target.

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
```

See [`examples/symbols.thunk`](../../../examples/symbols.thunk), [`examples/symbols-hierarchy.thunk`](../../../examples/symbols-hierarchy.thunk), [`examples/failures.thunk`](../../../examples/failures.thunk).

## Related

- [Branding](./branding.md)
- [Symbol.of](./symbol-of.md)
- [Symbol.is](./symbol-is.md)
- [Failure hierarchy](./failure-hierarchy.md)
- [Requires](../types/requires.md)
