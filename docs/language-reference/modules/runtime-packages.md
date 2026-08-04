# Runtime packages

| Package | Who imports | Contents |
|---|---|---|
| `@thunk/runtime` | Authors (explicit) | `use`, `provide`, `layerOf`, `mergeLayers`, `symbolOf`, `Symbol` |
| `@thunk/runtime/internal` | Lowerer only | `succeed`, `defer`, `bind`, `execute`, `__makeSymbol` |
| `@thunk/types` | Lowerer (auto) | `Thunk`, `Requires`, `ThunkSymbol`, `SymbolType`, … |

## Related

- [Imports](./imports.md)
- [Symbol.of](../symbols/symbol-of.md)
- [CLI](../tooling/cli.md)
