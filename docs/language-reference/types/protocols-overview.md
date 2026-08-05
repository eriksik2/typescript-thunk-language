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

const t: Thunk<number> Async = wrap(() => Promise.resolve(1))
```

## Encoding

Lowered to a TypeScript object type keyed by protocol identities (e.g. `Requires`, `Async`). The language service pretty-prints bags back to postfix form.

`Thunk<T, P>` keeps `P` **invariant** so nonempty bags are not structurally assignable to `EmptyProtocols` (`{}`). Otherwise `Thunk<T> Requires(X)` would wrongly assign to `Thunk<T>`.

## Assignability (built-ins)

| From → To | Allowed? |
|---|---|
| `Thunk<T> Requires(X)` → `Thunk<T>` | No |
| `Thunk<T> Async` → `Thunk<T>` | No |
| `Thunk<T> Async` → `Thunk<T> Async` | Yes |
| `provide(thunk, layer)` → `Thunk<T>` | Yes, when requirements are fully discharged |

## Related

- [Requires](./requires.md)
- [Async](./async.md)
- [Thunk type](./thunk-type.md)
- [use](../environment/use.md) / [provide](../environment/provide.md)
- [wrap](../core/wrap.md)
