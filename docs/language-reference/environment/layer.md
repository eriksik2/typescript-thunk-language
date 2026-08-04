# Layer

## What it is

A `Layer` is an environment fragment: a map of symbol keys → implementations, typed by the identities it provides.

## APIs (import from `@thunk/runtime`)

```ts
layerOf(Database, impl)           // Layer<typeof Database>
mergeLayers(a, b)                 // Layer<A | B>
provide(thunk, layer)
```

Still useful when:

- merging multiple services
- providing **primitive** associated types (no identity stamp on naked numbers)
- providing a raw associated value without branding

For a single branded object, prefer [`provide(thunk, DatabaseLive)`](./provide.md).

## Related

- [provide](./provide.md)
- [use](./use.md)
- [Symbol.of](../symbols/symbol-of.md)
