# Thunk Language — Architecture Decision

**Status:** Accepted  
**Priority:** M1 done; next language features (M2+)  
**Date:** 2026-08-04 (milestones reordered same day: Volar before M2+; M1 completed)

---

## 1. What this is

Thunk is a **TypeScript-adjacent language**: its own syntax and semantics, intentionally familiar to TypeScript, running on the TypeScript type checker and the JavaScript runtime.

It is **not**:

- a TypeScript subset;
- a TypeScript superset;
- a TypeScript language-service plugin that “adds keywords”;
- a from-scratch type checker.

Programmers write `.thunk` (or `.th.ts`) source. The compiler **lowers** that source into ordinary TypeScript that references a small runtime. The editor shows types for the *surface* language by checking the lowered TypeScript and mapping results back through source maps.

---

## 2. The non-negotiable: editor support

Hover, go-to-definition, completions, and diagnostics on **Thunk syntax** (including `thunk`, `run`, postfix protocols, and pipes) are a first-class requirement.

That constraint eliminates several otherwise attractive approaches.

| Approach | Custom syntax | Real `tsc` / emit | Hover on custom syntax | Verdict |
|---|---|---|---|---|
| TypeScript LS plugin only | No | No change to `tsc` | No (cannot parse new syntax) | Rejected |
| ts-patch / transformers only | No (TS AST only) | Yes | Weak / none for new syntax | Rejected as sole base |
| Full TypeScript fork | Yes | Yes | Yes | Too costly to rebase; defer |
| Custom type checker from scratch | Yes | Possible | Yes | Reinvents TS; rejected |
| **Lower → virtual TypeScript + source maps** | Yes | Yes (same pipeline) | Yes | **Chosen** |

This is the same family of architecture used by Vue (Volar), Svelte, Astro, and MDX: **transform-first, virtual documents, position mapping**.

---

## 3. Decision: Lower-to-TypeScript virtual documents

### 3.1 Pipeline (shared by editor and CLI)

```text
.thunk source
      │
      ▼
  Parse (language front-end)
      │
      ▼
  Extended AST
      │
      ▼
  Thunk lowering  (thunk / run / pipe → defer / bind / succeed / execute)
      │
      ▼
  Protocol encoding into TypeScript types
      │
      ▼
  Virtual TypeScript document  +  source maps
      │
      ├──────────────────────────────┐
      ▼                              ▼
 TypeScript Language Service      Emit JavaScript
 (hover, diagnostics, …)          (CLI / bundler)
      │
      ▼
 Map positions / types back to .thunk source
```

**One lowering.** The editor and the compiler must not diverge. If hover says `Thunk<User, Requires<Database>>`, emit must produce code whose runtime behavior matches that type story.

### 3.2 Why TypeScript remains the type engine

- Ordinary TS syntax, modules, generics, and structural typing stay free.
- Protocol bags are **encoded** as TypeScript types (phantom / branded structure), then checked by `tsc` / tsserver.
- Protocol type functions (`bind`, `execute`, …) lower to TypeScript conditional / mapped types (or small generated aliases) whenever possible.
- Where TS cannot express a rule (protocol-aware bag normalization that is not intersection), the front-end normalizes **before** emitting types, then hands TS a normalized encoding.

TypeScript is the host type system. Thunk owns protocol-bag normalization and the surface syntax.

### 3.3 Editor stack

**Done (M0 prototype kernel):**

1. Shared `language-core` (parse → lower → map).
2. A thin host around `typescript.createLanguageService` that serves **lowered** text for `.thunk` files.
3. Position mapping for hover / diagnostics (`bun run proof:hover`).

**Done (M1 — Volar + extension + CLI):**

- Volar.js language plugin + Cursor/VS Code extension on `.thunk`.
- CLI emit sharing `language-core`.
- `language-core` stays free of VS Code APIs.

**Next (M2 — language growth):** pipes, multi-`run`, defer placement. Then protocols (M3) and `use`/`provide` (M4). See §9 and `LANGUAGE.md`.

Do **not** start with a TypeScript fork or a bespoke type checker.
Do **not** skip to protocols / `use`/`provide` before M2 hardening of multi-`run` lowering.

---

## 4. Source form and compilation units

### 4.1 File extension

| Extension | Role |
|---|---|
| `.thunk` | Primary Thunk source (recommended) |
| `.th.ts` | Optional alternate for tooling that keys off `.ts` |
| `.ts` / `.js` | Ordinary TypeScript/JavaScript; may import runtime + lowered `.thunk` output |

Plain `.ts` does **not** accept `thunk { … }` syntax. That keeps “not a TS superset” honest and avoids fighting stock tsserver on `.ts` files.

### 4.2 Imports

Lowered modules look like normal TypeScript/ESM. A `.thunk` file that exports `program` becomes a `.ts` (or `.js`) module exporting the same binding after lowering. Editors resolve imports through the virtual document graph the same way Volar resolves `.vue` → script.

---

## 5. Encoding protocols in TypeScript

Surface:

```ts
Thunk<User>
  Requires(Database | Logger)
  Once
```

Lowered type encoding (provisional):

```ts
Thunk<
  User,
  ProtocolBag<{
    [Requires]: Database | Logger
    [Once]: void
  }>
>
```

Or an equivalent branded intersection. Exact spelling is an implementation detail; requirements are:

1. Hover can pretty-print back to postfix protocol syntax (language service presentation layer).
2. `Protocol<T>`, `Strip<T>`, `Omit<Bag, Requires>`, etc. are real TypeScript types over that encoding.
3. `Requires.bind<A, B>` is a TypeScript type alias / conditional type used by inferred composition **and** by explicit APIs like `provide`.
4. Normalization (`Requires(A)` + `Requires(B)` → `Requires(A | B)`) is performed by the Thunk front-end (or by dedicated type utilities that implement `bind`), never by assuming TS intersection of duplicate keys.

Absent protocol entries use the protocol’s `succeed<>` identity (for `Requires`: `never`).

**Status:** Type carrier + `MergeProtocols` (simplified to `EmptyProtocols` when empty) + hover pretty-print are landed. Postfix `Requires`/`Once` in `.thunk`, `protocol` declarations, and `Tag`/`use`/`Layer`/`provide` are landed. See `FEATURES.md` and `examples/requires.thunk`.

---

## 6. Runtime vs types

Keep the design doc’s separation:

| Layer | Owns |
|---|---|
| Type / protocol system | Return types, protocol payloads, composition, `execute` validation, `provide` transforms |
| Runtime | `succeed` / `defer` / `bind` / `execute`, environment, `use`, `provide` |

Function signatures declare protocol transforms explicitly. The compiler does not infer protocol changes by inspecting runtime bodies.

Initial runtime representation: tagged nodes (`succeed` | `defer` | `bind` | `use` | `provide`) with a recursive executor. Iterative stacks can come later.

---

## 7. Parser strategy

### 7.1 Chosen: hybrid front-end

1. **Language-specific parser** for: `thunk`, `run`, `|` pipe, `protocol` declarations, postfix protocol type syntax.
2. **TypeScript compiler API** for ordinary expressions, statements (where allowed), type annotations, and modules once those regions are ordinary TS or after local desugaring.
3. **Thunk-body lowering** operates on a statement-oriented AST so continuations preserve lexical scope.

### 7.2 Initial restrictions (as in the language design)

Supported early:

```ts
const user = run getUser()
return user
```

Not in v0:

```ts
return (run getUser()).name
```

Also deferred: `run` in loop conditions, `finally`, unsupported control-flow crossing. Prefer correct, readable `bind`/`defer` output over full JS CFG support.

### 7.3 Why not text-only macros

Pure string rewrites break nested scopes and produce bad maps. Statement-level AST + source maps are the minimum for trustworthy hover.

---

## 8. Repository layout

```text
packages/
  language-core/     # parse, AST, lowering, source maps  ← shared kernel
  runtime/           # succeed, defer, bind, execute, Tag, Layer, use, provide
  types/             # Thunk<T, P>, ProtocolBag, Requires, utilities
  language-service/  # Volar language plugin + shared LS helpers (wraps language-core)
  vscode/            # Cursor / VS Code extension (thin host; activates on .thunk)
  compiler/          # CLI: lower + emit (+ watch later)

docs/
  ARCHITECTURE.md    # this file
  LANGUAGE.md        # canonical language design (syntax, semantics, protocols)
  FEATURES.md        # per-feature status, examples, expected behavior

examples/            # .thunk samples (used as the extension smoke fixture)
scripts/             # proof scripts (proof:hover) and future extension helpers
```

### 8.1 Volar package sketch (M1 target)

Keep editor glue thin. All parse/lower/map stays in `language-core`.

```text
packages/language-service/
  src/
    index.ts              # public exports
    create-thunk-project.ts   # existing M0 TS LS host (keep for tests / CLI proofs)
    volar/
      language.ts         # Volar LanguagePlugin<.thunk>: create virtual TS + maps
      service.ts          # optional service plugin (hover presentation later)
      index.ts

packages/vscode/
  package.json            # contributes languages: thunk, .thunk; activationEvents
  src/
    extension.ts          # activate → @volar/language-server / lab compatible
  language-configuration.json
  syntaxes/               # TextMate (minimal: comments + keywords) — optional in M1
  tsconfig.json
  README.md               # F5 / vsce launch instructions

packages/compiler/
  src/
    index.ts              # lowerThunkSource → write .ts / .js (same maps)
    cli.ts                # thunk build <file>  (minimal)
```

**Dependency direction:**

```text
vscode  →  language-service  →  language-core
compiler →  language-core
language-service may use typescript + @volar/* ; language-core must not
```

The existing exploratory `src/` Continuation/Thunk library is **not** the language; it may inform the runtime, but the architecture above replaces it as the product surface.

---

## 9. Milestones (Volar environment first)

Language features after M0 were frozen until the editor loop was real (M1). With M1 done, grow the language per M2+ below. One working editor loop remains the base for all further design.

### M0 — Prove the editor path (kernel)

- Parse a tiny subset: `thunk { return <expr> }`, `run <ident>`, bindings between runs.
- Lower to `defer` / `bind` / `succeed` / `execute` calls against `runtime`.
- Produce source maps (most-specific overlap resolution).
- Run TypeScript’s type checker on the virtual document.
- Map a hover query at a `.thunk` offset → type string from TS.

**Status: done.** `bun run proof:hover` shows hover on `const value = run random` as `(parameter) value: number`.

### M1 — Volar + Cursor/VS Code environment

**Status: done.** Extension + CLI emit share `language-core`; hover/diagnostics work in the editor on the M0 subset.

Goal (achieved): open `examples/basic.thunk`, see types and diagnostics, and compile with the same lowering — even if the language still only supports the M0 subset.

1. **Volar language plugin** in `@thunk/language-service` that exposes virtual TypeScript from `language-core` (same maps as M0).
2. **`packages/vscode` extension** that activates on `.thunk` and runs the Volar language server / plugin.
3. **CLI emit** (`@thunk/compiler`): lower a file to disk; share `language-core` with the plugin (no second compiler).
4. **Setup instructions**: install deps, launch Extension Development Host (F5 / Cursor equivalent), open `examples/`, confirm hover on `value`.
5. **Reload strategy** (document + implement the minimum that works):
   - Extension host reload for `packages/vscode` changes.
   - Rebuild/watch for `language-core` / `language-service` (extension must pick up new plugin code — typically restart LS or reload window).
   - Investigate Volar Labs / take-over mode for faster iteration; record what works in the vscode package README.
6. **Smoke checklist**: hover, diagnostics mapped to `.thunk`, one successful `thunk` CLI emit of `examples/basic.thunk`.

**Exit criterion:** a developer can feel the language in the editor without running `proof:hover`.

### M2 — Pipe + multi-`run` + `defer` placement ← **next**

See `LANGUAGE.md` §§6–8. Grow the M0 lowerer/parser without protocols yet.

- Pipe syntax and precedence with `run` (`run tx | f` → `run (tx | f)`).
- Multiple sequential `run`s and ordinary statements between them.
- Eager-vs-deferred correctness for code before first `run` (already partially in M0; harden + test).

### M3 — Protocol bag encoding + `Requires`

**Status: largely done** (type-level + postfix surface + pretty hover). Remaining polish: richer protocol declaration wiring beyond emitted type aliases.

### M4 — `use` / `provide` / `Layer`

**Status: done** for the initial tagged-env model (`createTag`, `use`, `layerOf`, `provide`, env-aware `execute`). See `examples/requires.thunk`.

---

## 10. Open questions (implementation-facing)

Resolved unless revisited:

| Topic | Decision |
|---|---|
| Protocol defaults (`succeed` / `defer`) | Inherited defaults |
| Protocol identity | From `succeed<>` |
| Partial protocol matching | Yes — extra protocols remain on `Th` |
| Editor base | Virtual TypeScript documents + maps via **Volar.js** (M1) |
| File extension | `.thunk` primary |
| Type host | Stock TypeScript checker on lowered code |
| Feature order | Editor environment before new syntax |

Still open (do not block M1):

- Exact public names: `Protocol` / `Strip` / `ReturnType` / `Omit`.
- Pretty-printer for hover (show postfix protocols vs raw encoding).
- Whether `.th.ts` is worth supporting besides `.thunk`.
- Best Volar major version / `@volar/language-server` vs hybrid for Cursor.
- Whether TextMate grammar ships in M1 or can wait until keywords stabilize.

---

## 11. Summary

**Thunk is a lower-to-TypeScript language.**  
**Editor support comes from checking virtual TypeScript and mapping back.**  
**One shared `language-core` serves both the language service and the compiler.**  
**Protocols are encoded as TypeScript types after protocol-aware normalization.**  
**Do not fork TypeScript and do not rely on LS plugins alone.**  
**M1 is done. Next work is M2: pipes + multi-`run` + defer placement — then protocols (M3) and `use`/`provide` (M4). Language semantics: `LANGUAGE.md`.**
