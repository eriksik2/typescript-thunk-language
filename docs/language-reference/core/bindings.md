# Bindings

## What it is

`const` / `let` introduce names. Inside thunks, bindings before a `run` stay in scope after `run` (the lowerer hoists locals across state-machine suspension points).

## Syntax

```ts
const name = expr
const name: Type = expr
const name: Thunk<T> Requires(Database) = thunk { … }
```

Optional type annotations may include postfix [protocols](../types/protocols-overview.md).

## Related

- [Thunk blocks](./thunk-blocks.md)
- [Thunk type](../types/thunk-type.md)
- [Requires](../types/requires.md)
