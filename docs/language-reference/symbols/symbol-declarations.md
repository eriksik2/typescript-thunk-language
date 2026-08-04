# symbol declarations

## What it is

A `symbol` declaration introduces **one value** and **one nominal type** with the same name.

| Form | Associated type `T` |
|---|---|
| `symbol Age = number` | `number` |
| `symbol Database { name: string }` | `{ name: string }` (sugar for `= { … }`) |

## Semantics

1. **Value** `Name` — identity typed by `T`; callable for [branding](./branding.md); has `.key` for the env map.
2. **Type** `Name` — branded inhabitants (nominal over `T`).
3. `Name` → `T` assignable; `T` → `Name` only via `Name(...)`.
4. Env APIs take the **value** `Name` (`use` / `layerOf`) or a branded object ([`provide`](../environment/provide.md)).

Anonymous `symbol { }` in expressions is out of scope.

## Examples

```ts
symbol Age = number

symbol Database {
  name: string
}
```

See [`examples/symbols.thunk`](../../../examples/symbols.thunk), [`examples/requires.thunk`](../../../examples/requires.thunk).

## Related

- [Branding](./branding.md)
- [Symbol.of](./symbol-of.md)
- [Requires](../types/requires.md)
