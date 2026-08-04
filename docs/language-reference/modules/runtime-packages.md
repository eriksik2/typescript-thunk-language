# Runtime packages

| Package | Who imports | Contents |
|---|---|---|
| `@thunk/runtime` | Authors (explicit) | `use`, `provide`, `layerOf`, `mergeLayers`, `wrap`, `symbolOf`, `symbolIs`, `symbolHas`, `symbolTo`, `symbolExtends`, `Symbol`, Failure hierarchy (`Failure`, `Defect`, `UnhandledError`, `Error`), Result (`Ok`, `Err`, `Result`) |
| `@thunk/runtime/internal` | Lowerer only | `succeed`, `defer`, `runEffect`, `machine`, `execute`, `__makeSymbol`, `__awaitPromise` (`bind` kept for hand-written use) |
| `@thunk/types` | Lowerer (auto) | `Thunk`, `Requires`, `Async`, `ThunkReturnType`, `ThunkSymbol`, `SymbolType`, … |

## Related

- [Imports](./imports.md)
- [Symbol.of](../symbols/symbol-of.md)
- [CLI](../tooling/cli.md)
