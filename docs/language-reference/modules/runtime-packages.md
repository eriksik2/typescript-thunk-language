# Runtime packages

| Package | Who imports | Contents |
|---|---|---|
| `@thunk/runtime` | Authors (explicit) | `use`, `provide`, `layerOf`, `mergeLayers`, `symbolOf`, `Symbol` |
| `@thunk/runtime/internal` | Lowerer only | `succeed`, `defer`, `runEffect`, `machine`, `execute`, `__makeSymbol` (`bind` kept for hand-written use) |
| `@thunk/types` | Lowerer (auto) | `Thunk`, `Requires`, `ThunkReturnType`, `ThunkSymbol`, `SymbolType`, … |

## Related

- [Imports](./imports.md)
- [Symbol.of](../symbols/symbol-of.md)
- [CLI](../tooling/cli.md)
