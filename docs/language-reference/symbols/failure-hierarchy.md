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
| `Failure` | Abstract root — `Symbol.has` / `Symbol.to` target; cannot brand |
| `Defect` | Faulty / corrupted program (e.g. unexpected naked throws) |
| `UnhandledError` | External failure not yet handled (e.g. `wrap` / Promise rejection) |
| `Error` | Ordinary tagged application error |

Associated payload: `{ message: string }`.

**No value LSP:** a `Defect` is not assignable to `Failure`. Use `Symbol.has` / `Symbol.to`.

## Surface

```ts
import {
  Failure,
  Defect,
  UnhandledError,
  Error,
  Symbol,
} from "@thunk/runtime"

const d = Defect({ message: "invariant" })
Symbol.is(d, Defect)     // true
Symbol.is(d, Failure)    // false
Symbol.has(d, Failure)   // true
Symbol.to(d, Failure)    // Failure-shaped view; of(d) still Defect
```

Importing `Error` shadows the platform `Error` constructor in that scope — use `globalThis.Error` when you need it.

Typed failure channels, `try` / `catch`, and discharging errors on thunks remain deferred. `wrap` rejection → `UnhandledError` is the bare-minimum bridge.

## Examples

[`examples/failures.thunk`](../../../examples/failures.thunk)

## Related

- [symbol declarations](./symbol-declarations.md)
- [Symbol.is / has / to](./symbol-is.md)
- [Branding](./branding.md)
- [Runtime packages](../modules/runtime-packages.md)
