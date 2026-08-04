# Branding

## What it is

Calling the symbol value brands an associated-type inhabitant:

```ts
symbol Age = number
const a: Age = Age(30)
const n: number = a   // ok
// const bad: Age = 30 // error
```

```ts
symbol Database { name: string }
const DatabaseLive = Database({ name: "live" })
```

## Identity retention (objects)

For **object** (and function) values, branding **stamps** the symbol identity onto the value. That enables:

- [`Symbol.of(DatabaseLive)`](./symbol-of.md) → `Database`
- [`provide(thunk, DatabaseLive)`](../environment/provide.md) without `layerOf`

Primitives (`Age(30)`) stay naked so `Age` → `number` assignability holds; use [`layerOf`](../environment/layer.md) when providing primitive services.

## Related

- [symbol declarations](./symbol-declarations.md)
- [Symbol.of](./symbol-of.md)
- [provide](../environment/provide.md)
