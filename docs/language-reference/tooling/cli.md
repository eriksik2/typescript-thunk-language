# CLI

## Commands

```bash
bun run thunk -- build <file.thunk> [--out path]
bun run thunk -- run <file.thunk>
```

### build

Lower to sibling `.thunk.ts` (or `--out`) and write the file.

### run

Lower to sibling `.thunk.ts`, then `bun` that file (inherit stdio). Exit code follows the child. Top-level `run` / side effects are the program — no special “print last binding”.

## Related

- [Imports](../modules/imports.md)
- [run](../core/run.md)
- [Editor](./editor.md)
