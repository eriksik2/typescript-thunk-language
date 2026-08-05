# Result (`Ok` / `Err`)

## What it is

Built-in generic symbols for a success/failure **value** union:

```ts
import { Ok, Err, type Result } from "@thunk/runtime"

// conceptually:
// symbol Ok<A> = A
// symbol Err<E> = E
type Result<A, E> = Ok<A> | Err<E>
```

This is a tagged union of symbols — not a Fail protocol on `Thunk` yet. Discharge / typed error channels remain separate.

## Usage

```ts
const r: Result<number, string> = Ok(1)

const msg = match (r) {
  Ok: infer n => "ok " + n,
  Err: infer e => "err " + e,
}
```

Closed application errors are ordinary leaf unions (often extending [`Error`](../symbols/failure-hierarchy.md)):

```ts
symbol NotFound extends Error { path: string }
symbol Conflict extends Error { resource: string }
type AppErr = NotFound | Conflict
```

## Related

- [match](../core/match.md)
- [is](../core/is.md)
- [Failure hierarchy](../symbols/failure-hierarchy.md)
- [symbol declarations](../symbols/symbol-declarations.md)
