# typescript-thunk-language

Thunk is a TypeScript-adjacent language: familiar imperative style, custom `thunk` / `run` / protocol syntax, compiled by **lowering to TypeScript** and a small JS runtime.

Language design: [docs/LANGUAGE.md](./docs/LANGUAGE.md).  
**Language reference (browse by feature):** [docs/language-reference/](./docs/language-reference/README.md).  
Feature status: [docs/FEATURES.md](./docs/FEATURES.md).  
Implementation / editor: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Status

| Milestone | Status |
|---|---|
| **M0** — parse → lower → TS hover mapping (kernel) | Done (`bun run proof:hover`) |
| **M1** — Volar.js plugin + Cursor/VS Code extension + CLI emit | Done — [packages/vscode/README.md](./packages/vscode/README.md) |
| **Typed core** — `Thunk<T, P>`, type-level `Requires`, pretty hover | Done |
| **Protocols surface** — postfix syntax, `symbol`, `use`/`provide`/`Layer`, `protocol` decls | Done |
| **M2** — pipes + multi-`run` + `defer` placement | **Next** |

## Packages

| Package | Role |
|---|---|
| `@thunk/language-core` | Parse, AST, lowering, source maps |
| `@thunk/runtime` | Author APIs: `use` / `provide` / `layerOf` / `Symbol.of` / … (explicit import) |
| `@thunk/runtime/internal` | Compiler helpers: `succeed` / `defer` / `bind` / `execute` / `__makeSymbol` |
| `@thunk/types` | `Thunk` encoding, `Requires`, `ThunkSymbol` / `SymbolType` (`Thunk` auto-injected) |
| `@thunk/language-service` | TS LS host (M0) + Volar language plugin / server |
| `@thunk/compiler` | CLI: `thunk build` / `thunk run` |
| `@thunk/vscode` | Editor extension — [setup & F5](./packages/vscode/README.md) |

## Develop

```bash
bun install
bun run proof:hover      # hover: Thunk<number> + run binding number
bun run proof:requires   # symbol + Requires(Database) surface hover
bun run test             # core + types + runtime + language-service
bun run thunk -- build examples/basic.thunk
bun run thunk -- run examples/basic.thunk
bun run thunk -- build examples/requires.thunk   # needs: import { use, provide, layerOf } from "@thunk/runtime"
bun run thunk -- run examples/requires.thunk
bun run thunk -- build examples/symbols.thunk    # branding
bun run build:editor   # language-server + vscode extension
```

Editor F5, reload strategy, and the manual hover/diagnostics checklist live in [packages/vscode/README.md](./packages/vscode/README.md).

## Legacy

The top-level `src/` Continuation sketches are exploratory runtime experiments, not the language surface.
