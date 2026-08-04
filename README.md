# typescript-thunk-language

Thunk is a TypeScript-adjacent language: familiar imperative style, custom `thunk` / `run` / protocol syntax, compiled by **lowering to TypeScript** and a small JS runtime.

**Editor support is the first priority.** Hover and diagnostics work by typechecking a virtual TypeScript document and mapping positions back to `.thunk` source. See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Status

Architecture decision locked; M0 proof-of-concept for parse → lower → TypeScript hover mapping is in progress under `packages/`.

## Packages

| Package | Role |
|---|---|
| `@thunk/language-core` | Parse, AST, lowering, source maps |
| `@thunk/runtime` | `succeed` / `defer` / `bind` / `execute` |
| `@thunk/types` | `Thunk` type encoding + protocol utilities |
| `@thunk/language-service` | TypeScript LS host / future Volar plugin |
| `@thunk/compiler` | CLI |

## Develop

```bash
bun install
bun run proof:hover
```

## Legacy

The top-level `src/` Continuation sketches are exploratory runtime experiments, not the language surface.
