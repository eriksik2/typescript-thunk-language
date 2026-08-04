# Editor

## What it is

Volar-based language support for `.thunk`: lower to virtual TypeScript, map hover/diagnostics back, pretty-print `Thunk` / `Requires` / symbols.

## Setup

See [`packages/vscode/README.md`](../../../packages/vscode/README.md) (F5, rebuild `build:editor`).

## Proofs

```bash
bun run proof:hover
bun run proof:requires
```

## Related

- [CLI](./cli.md)
- [Architecture](../../ARCHITECTURE.md)
- [Thunk type](../types/thunk-type.md) — hover pretty-print
