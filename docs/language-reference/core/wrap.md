# wrap

## What it is

Lift a JavaScript `Promise` (or a lazy `() => Promise`) into a thunk. Introduces the [`Async`](../types/async.md) protocol.

```ts
import { wrap } from "@thunk/runtime"

const n = run wrap(() => Promise.resolve(1))
```

## Forms

| Call | Notes |
|---|---|
| `wrap(() => promise)` | Preferred — stays inert until execute |
| `wrap(promise)` | OK inside a running body; Promise already started |

Do **not** write `run somePromise` — keep Thunk and Promise distinct. Sequencing stays `run`.

## Failures

Promise rejection throws a branded [`UnhandledError`](../symbols/failure-hierarchy.md) (`Symbol.is(err, UnhandledError)`). Full typed catch channels are deferred.

## Examples

[`examples/async-wrap.thunk`](../../../examples/async-wrap.thunk)

## Related

- [Async](../types/async.md)
- [run](./run.md)
- [Failure hierarchy](../symbols/failure-hierarchy.md)
- [Runtime packages](../modules/runtime-packages.md)
