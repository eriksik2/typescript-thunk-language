# Protocols overview

## What it is

Thunks carry a **protocol bag** alongside the yield type. Protocols describe capabilities / constraints (requirements, flags, …) that compose on `bind` and are checked on `execute`.

## Surface syntax

Postfix on type annotations:

```ts
const op: Thunk<User>
  Requires(Database | Logger)
  Once
= thunk { … }
```

## Encoding

Lowered to a TypeScript object type keyed by protocol identities (e.g. `Requires`). The language service pretty-prints bags back to postfix form.

## Related

- [Requires](./requires.md)
- [Async](./async.md)
- [Thunk type](./thunk-type.md)
- [use](../environment/use.md) / [provide](../environment/provide.md)
- [wrap](../core/wrap.md)
