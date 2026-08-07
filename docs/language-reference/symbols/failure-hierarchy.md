# Failure hierarchy

## What it is

Built-in symbol tree for classifying failures:

```
Failure          (abstract)
├── Defect
├── UnhandledError
└── Error
```

Payload: `{ message: string }`.

| Symbol | Role |
|---|---|
| `Failure` | Abstract root — `Symbol.isAny` / `Symbol.to` target; cannot brand |
| `Defect` | Faulty / corrupted program (e.g. unexpected naked throws) |
| `UnhandledError` | External failure not yet handled (e.g. `wrap` / Promise rejection) |
| `Error` | Ordinary tagged application error (shadows platform `Error` if imported) |

**No value LSP:** a `Defect` is not assignable to `Failure`. Use `Symbol.isAny` / `Symbol.to`.

```ts
import {
  Failure,
  Defect,
  UnhandledError,
  Error,
  Symbol,
} from "@thunk/runtime"

const d = Defect({ message: "invariant" })
Symbol.is(d, Defect)       // true
Symbol.is(d, Failure)      // false
Symbol.isAny(d, Failure)   // true
Symbol.to(d, Failure)      // Failure-shaped view; of(d) still Defect
```

Application errors are **leaves under `Error`**, used directly in yield unions
(see [Fallibility](../types/fallibility.md)). Prefer `is any Error` for pedigree
catch-alls; exact `is` / `match` for closed leaf sets.

`try` / `catch` / `finally` blocks remain deferred. `wrap` rejection → `UnhandledError`
is the bare-minimum async bridge.

## Related

- [Fallibility](../types/fallibility.md)
- [`try`](../core/try.md)
- [Symbol.is / isAny](./symbol-is.md)
- [Branding](./branding.md)
- [`wrap`](../core/wrap.md)
