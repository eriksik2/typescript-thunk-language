# Thunk VS Code / Cursor extension

Editor support for `.thunk` files via Volar.js and `@thunk/language-service`.

## Install

From the repo root:

```bash
bun install
bun run build:editor
```

`build:editor` builds the language server (`@thunk/language-service`) and this extension’s `dist/extension.js`.

## Launch (F5)

1. Open this repo in VS Code or Cursor.
2. Run and Debug → **Launch Thunk Extension** (F5).  
   The launch config uses `--extensionDevelopmentPath=packages/vscode` and opens `examples/`.
3. In the Extension Development Host, open `examples/basic.thunk`.

## Code Browser

Activity bar **Thunk**: horizontal **Feature tags** toggles, then **Code Browser** (folder / nested feature tree / tags). **+ file** and **+ feature** open an editor with prelude + cursor on the name; Save creates the file.

## Manual F5 checklist

Do these in the Extension Development Host after F5:

1. **Code Browser** — Open the Thunk activity-bar icon; confirm examples appear under feature `Examples` (and tags). Switch to Files / Tags; try Filter.
2. **Hover on run binding** — On `value` in `const value = run random`, hover should show a type mentioning `number`.
3. **Hover on thunk** — On `random` or `program`, hover should show **`Thunk<number>`** only (not `RuntimeThunk`, not `Protocols(Omit<…>)`, not `EmptyProtocols`).
4. **Type error diagnostic** — Temporarily change the return to something invalid (e.g. `return value * "x"`). A TypeScript diagnostic should appear on the `.thunk` line.
5. **Parse error** — Introduce a syntax error (e.g. remove a brace). A parse diagnostic should appear and the language server should stay alive.
6. **Optional:** open `examples/requires.thunk` — hover on `fetchUser` should mention `Requires`.

Revert smoke edits after checking.

## Reload strategy

| What you changed | What to do |
|---|---|
| Extension client (`packages/vscode/src`, TextMate, contributes) | Reload the Extension Development Host window (Developer: Reload Window). |
| Language server, Volar plugin, or `language-core` | Run `bun run build:editor`, then restart the language server **or** reload the Extension Development Host window. |
| Only `language-core` / mappings while LS is already running | Rebuild LS (`bun run --filter @thunk/language-service build`), then restart LS / reload window so the host picks up the new `dist/server.js`. |

The F5 config’s `preLaunchTask` runs `build:editor` once at launch; later edits still need an explicit rebuild when the server bundle changes.

## Volar Labs

Optional but useful for debugging M1:

1. Install the **Volar Labs** extension in the Extension Development Host (or main window, then reload the host).
2. Open a `.thunk` file and use Labs to inspect the embedded virtual TypeScript document and mappings.

The extension exports Labs info from `activate` so Labs can attach to the Thunk language client.

## Smoke checklist

Automated (from repo root):

```bash
bun run proof:hover
bun run test:core
bun run test:ls
bun run thunk -- build examples/basic.thunk   # then delete the emitted .thunk.ts
bun run build:editor
```

Manual (F5 — see checklist above):

- [ ] Hover on `value` → type mentions `number`
- [ ] Deliberate type error → diagnostic on `.thunk` source
- [ ] Parse error → diagnostic, LS does not crash
