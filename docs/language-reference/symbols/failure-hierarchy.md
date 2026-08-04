# Failure hierarchy

## What it is

Built-in hierarchical symbols for tagged failures (not a full error-handling model yet).

```
Failure          (abstract)
├── Defect
├── UnhandledError
└── Error
```

| Symbol | Role |
|---|---|
| `Failure` | Abstract root — type + `Symbol.is` target; cannot brand |
| `Defect` | Faulty / corrupted program (e.g. unexpected naked throws) |
| `UnhandledError` | External failure not yet handled (e.g. future `wrap` / Promise rejection) |
| `Error` | Ordinary tagged application error |

Associated payload: `{ message: string }`.

## Surface

```ts
import {
  Failure,
  Defect,
  UnhandledError,
  Error,
  Symbol,
} from "@thunk/runtime"

const d: Failure = Defect({ message: "invariant" })
Symbol.is(d, Failure)   // true
Symbol.is(d, Defect)    // true
Symbol.of(d)            // Defect
```

Importing `Error` shadows the platform `Error` constructor in that scope — use `globalThis.Error` when you need it.

Promise rejection throws a branded [`UnhandledError`](../symbols/failure-hierarchy.md) (`Symbol.is(err, UnhandledError)`). Full typed catch channels are deferred.

Typed failure channels, `try` / `catch`, and discharging errors on thunks remain deferred. `wrap` rejection → `UnhandledError` is the bare-minimum bridge.

## Examples

[`examples/failures.thunk`](../../../examples/failures.thunk)

## Related

- [symbol declarations](./symbol-declarations.md)
- [Symbol.is](./symbol-is.md)
- [Branding](./branding.md)
- [Runtime packages](../modules/runtime-packages.md)
