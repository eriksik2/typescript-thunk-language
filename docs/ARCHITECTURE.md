# Thunk Language — Architecture Decision

**Status:** Accepted  
**Priority:** Editor support first; everything else second  
**Date:** 2026-08-04

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

**Near-term (prototype):**

1. Shared `language-core` (parse → lower → map).
2. A thin host around `typescript.createLanguageService` that serves **lowered** text for `.thunk` files.
3. Position mapping for hover / diagnostics.
4. A VS Code / Cursor extension that starts that language service (or speaks LSP).

**Medium-term:**

- Package the same core as a **Volar.js language plugin** so we get embedded-language mapping, multi-editor LSP, and Labs tooling without reinventing project glue.
- Keep `language-core` free of VS Code APIs so CLI and editor share one implementation.

Do **not** start with a TypeScript fork or a bespoke type checker.

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
  language-service/  # LS / Volar plugin wrapping language-core + typescript
  vscode/            # editor extension (Cursor / VS Code)
  compiler/          # CLI: lower + emit

docs/
  ARCHITECTURE.md    # this file
  LANGUAGE.md        # language design (from the design brief)

examples/            # .thunk samples
```

The existing exploratory `src/` Continuation/Thunk library is **not** the language; it may inform the runtime, but the architecture above replaces it as the product surface.

---

## 9. Prototype milestones (ordered by editor priority)

### M0 — Prove the editor path (this PR)

- Parse a tiny subset: `thunk { return <literal> }`, `run <ident>`, top-level `run`.
- Lower to `defer` / `bind` / `succeed` / `execute` calls against `runtime`.
- Produce source maps (most-specific overlap resolution).
- Run TypeScript’s type checker on the virtual document.
- Map a hover query at a `.thunk` offset → type string from TS.

**Status: proven.** `bun run proof:hover` shows hover on `const value = run random` as `(parameter) value: number`.

### M1 — Pipe + multi-`run` + `defer` placement

- Pipe precedence with `run`.
- Multiple sequential `run`s and ordinary statements between them.
- Eager-vs-deferred correctness for code before first `run`.

### M2 — Protocol bag encoding + `Requires`

- Postfix protocol syntax in types.
- Infer `Requires` through `bind`.
- Reject `execute` when requirements remain (`CompileError` encoding).

### M3 — `use` / `provide` / `Layer`

- Runtime environment + typed removal of requirements.

### M4 — Volar / VS Code packaging

- Ship an extension that uses the same `language-core` as the CLI.

---

## 10. Open questions (implementation-facing)

Resolved for the prototype unless revisited:

| Topic | Decision |
|---|---|
| Protocol defaults (`succeed` / `defer`) | Inherited defaults |
| Protocol identity | From `succeed<>` |
| Partial protocol matching | Yes — extra protocols remain on `Th` |
| Editor base | Virtual TypeScript documents + maps; Volar later |
| File extension | `.thunk` primary |
| Type host | Stock TypeScript checker on lowered code |

Still open (do not block M0):

- Exact public names: `Protocol` / `Strip` / `ReturnType` / `Omit`.
- Pretty-printer for hover (show postfix protocols vs raw encoding).
- Whether `.th.ts` is worth supporting besides `.thunk`.

---

## 11. Summary

**Thunk is a lower-to-TypeScript language.**  
**Editor support comes from checking virtual TypeScript and mapping back.**  
**One shared `language-core` serves both the language service and the compiler.**  
**Protocols are encoded as TypeScript types after protocol-aware normalization.**  
**Do not fork TypeScript and do not rely on LS plugins alone.**

Everything else in the language design (pipes, `Requires`, `use`/`provide`, richer control flow) builds on this base once M0 proves hover works.
