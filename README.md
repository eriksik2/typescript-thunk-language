# typescript-thunk-language

Thunk is a TypeScript-adjacent language: familiar imperative style, custom `thunk` / `run` / protocol syntax, compiled by **lowering to TypeScript** and a small JS runtime.

Language design: [docs/LANGUAGE.md](./docs/LANGUAGE.md).  
Feature status: [docs/FEATURES.md](./docs/FEATURES.md).  
Implementation / editor: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Status

| Milestone | Status |
|---|---|
| **M0** — parse → lower → TS hover mapping (kernel) | Done (`bun run proof:hover`) |
| **M1** — Volar.js plugin + Cursor/VS Code extension + CLI emit | Done — [packages/vscode/README.md](./packages/vscode/README.md) |
| **M2** — pipes + multi-`run` + `defer` placement | **Next** |
| M3+ — protocols, `use`/`provide` | After M2 |

## Packages

| Package | Role |
|---|---|
| `@thunk/language-core` | Parse, AST, lowering, source maps |
| `@thunk/runtime` | `succeed` / `defer` / `bind` / `execute` |
| `@thunk/types` | `Thunk` type encoding + protocol utilities |
| `@thunk/language-service` | TS LS host (M0) + Volar language plugin / server |
| `@thunk/compiler` | CLI lower + emit (`bun run thunk -- build …`) |
| `@thunk/vscode` | Editor extension — [setup & F5](./packages/vscode/README.md) |

## Develop

```bash
bun install
bun run proof:hover    # M0 kernel proof
bun run test:core
bun run test:ls        # mapping / Volar unit tests
bun run thunk -- build examples/basic.thunk
bun run build:editor   # language-server + vscode extension
```

Editor F5, reload strategy, and the manual hover/diagnostics checklist live in [packages/vscode/README.md](./packages/vscode/README.md).

## Legacy

The top-level `src/` Continuation sketches are exploratory runtime experiments, not the language surface.
