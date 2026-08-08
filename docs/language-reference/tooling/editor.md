# Editor

## What it is

Volar-based language support for `.thunk`: lower to virtual TypeScript, map hover/diagnostics back, pretty-print `Thunk` / `Requires` / symbols.

## Code Browser

The Thunk activity bar has a horizontal **Feature tags** toggle bar and a **Code Browser** tree (folder / nested feature / tag). **+ file** / **+ feature** open an editor with the prelude filled; Save creates the artifact. See [file prelude](../modules/file-prelude.md).

## Setup

See [`packages/vscode/README.md`](../../../packages/vscode/README.md) (F5, rebuild `build:editor`).

## Proofs

```bash
bun run proof:hover
bun run proof:requires
```

Effectful thunk yield types use the [oracle](./oracle.md) view (`surface-oracle.test.ts`).

## Related

- [Oracle](./oracle.md)
- [File prelude](../modules/file-prelude.md)
- [CLI](./cli.md)
- [Architecture](../../ARCHITECTURE.md)
- [Thunk type](../types/thunk-type.md) — hover pretty-print
