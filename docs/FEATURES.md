# Thunk Language — Feature Status

**Purpose:** Inventory of every language feature from [`LANGUAGE.md`](./LANGUAGE.md), with implementation status, intended surface, and concrete examples of what should happen.

**Companion docs:** language design → [`LANGUAGE.md`](./LANGUAGE.md); packaging / milestones → [`ARCHITECTURE.md`](./ARCHITECTURE.md).

**Status legend**

| Status | Meaning |
|---|---|
| **Done** | Implemented, exercised by tests or editor smoke, usable on `.thunk` |
| **Partial** | Core path exists; missing cases, tests, or surface syntax |
| **Scaffold** | Types or stubs exist; not wired through parse/lower/editor |
| **Not started** | Designed; no implementation yet |
| **Deferred** | Explicitly out of initial core (post–M4 / later) |

**Milestone targets** (from Architecture §9): M0/M1 done · **M2** pipes + multi-`run` · **M3** protocols + `Requires` · **M4** `use` / `provide` / `Layer`.

---

## Table of contents

1. [Core thunk surface](#1-core-thunk-surface)
2. [Atomic runtime primitives](#2-atomic-runtime-primitives)
3. [Lowering rules](#3-lowering-rules)
4. [`run` semantics](#4-run-semantics)
5. [Pipe syntax](#5-pipe-syntax)
6. [Protocol system](#6-protocol-system)
7. [`Requires`, tags, environment](#7-requires-tags-environment)
8. [Type utilities](#8-type-utilities)
9. [Tooling (editor / CLI)](#9-tooling-editor--cli)
10. [Explicitly deferred features](#10-explicitly-deferred-features)

---

# 1. Core thunk surface

## 1.1 `thunk { … }` expression

| | |
|---|---|
| **Status** | **Done** (M0) |
| **Milestone** | M0 |

**What it is.** Builds an *inert* computation. Constructing the thunk does not run the body.

**What it should look like.**

```ts
const value = thunk {
  return 42
}
```

**Cases**

| Example | Expected |
|---|---|
| `thunk { return 42 }` | Type conceptually `Thunk<number>`; body not executed at construction |
| `thunk { console.log("hi"); return 1 }` | Log only when the thunk is later `run` / `execute`d |
| Nested `thunk` in an initializer | Allowed; each thunk is its own inert value |

**Implementation notes.** Parsed as `ThunkExpression`; lowered to `defer(() => …)`.

---

## 1.2 Explicit `return` in thunk bodies

| | |
|---|---|
| **Status** | **Done** (M0) |
| **Milestone** | M0 |

**What it is.** Thunk bodies use explicit `return`. No implicit final-expression return.

**What it should look like.**

```ts
thunk {
  return user
}
```

**Cases**

| Example | Expected |
|---|---|
| `return expr` as last statement | Lowers to `succeed(expr)` (possibly inside a block) |
| Missing `return` | Currently may succeed with `undefined as void`; design prefers explicit return |
| Top-level `return` outside thunk | Error (M0 throws / rejects) |

---

## 1.3 Ordinary statements in thunk bodies

| | |
|---|---|
| **Status** | **Partial** |
| **Milestone** | M0 (basics) · richer control flow later |

**What it is.** Imperative `let`/`const`, expressions, and (eventually) familiar TS control flow inside thunks.

**What it should look like.**

```ts
thunk {
  let total = 0
  // … loops / if later
  return total
}
```

**Cases**

| Example | Expected |
|---|---|
| `const x = 1` before/after `run` | Stays in the appropriate continuation region |
| `for` / `while` / `if` containing **no** `run` | Should work as ordinary TS text once expression/statement parsing allows (hybrid `TsExpression` / statements) |
| `run` inside loop condition / `finally` | **Unsupported** initially — see LANGUAGE §17.3 |

**Implementation notes.** `const`/`let` and expression statements work. Full CFG with `run` is deferred. Loops as opaque TS regions are only as good as the hybrid parser’s statement coverage.

---

## 1.4 Hybrid TypeScript expressions

| | |
|---|---|
| **Status** | **Partial** (M0) |
| **Milestone** | M0+ |

**What it is.** Non-Thunk-specific expression text is captured as `TsExpression` and emitted verbatim into lowered TS.

**What it should look like.**

```ts
return value * 2
return { user, posts }
run getUser(id)
```

**Cases**

| Example | Expected |
|---|---|
| `value * 2` | Copied into `succeed(value * 2)` |
| `getUser(id)` after `run` | Operand of `bind` / `execute` |
| Nested braces/parens in object literals | Parser should track depth (M0 does) |

---

## 1.5 `Thunk<T>` type (return type only)

| | |
|---|---|
| **Status** | **Done** (type carrier + hover) |
| **Milestone** | Typed core (ahead of M3 surface syntax) |

**What it is.** A thunk’s primary type parameter is its produced value.

**What it should look like.**

```ts
const value: Thunk<number> = thunk {
  return 42
}
```

**Cases**

| Example | Expected |
|---|---|
| Pure thunk binding (`random`) | Hover shows `Thunk<number>` (not `RuntimeThunk`) |
| Empty protocol bag | Pretty-printer elides `EmptyProtocols` / `{}` |
| Runtime | Tagged nodes cast to `Thunk<T, P>` at API boundary (`@thunk/runtime`) |

**Implementation notes.** [`packages/types`](../packages/types/src/index.ts) defines `Thunk<T, P>`. Runtime primitives return `Thunk`. Language-service pretty-prints hover.

---

# 2. Atomic runtime primitives

## 2.1 `succeed`

| | |
|---|---|
| **Status** | **Done** (runtime + lowering) |
| **Milestone** | M0 |

**What it is.** Creates a completed thunk holding a value.

**What it should look like.**

```ts
succeed(42)  // Thunk<number>, no requirements under Requires defaults
```

**Cases**

| Example | Expected |
|---|---|
| Final `return` in a thunk | Becomes `succeed(…)` |
| Empty body | `succeed(undefined as void)` (current lowerer) |

---

## 2.2 `defer`

| | |
|---|---|
| **Status** | **Done** (runtime + lowering) |
| **Milestone** | M0 · harden M2 |

**What it is.** Delays construction/execution of the factory until the thunk is run.

**What it should look like.**

```ts
defer(() => succeed(calculate()))
```

**Cases**

| Example | Expected |
|---|---|
| Outer `thunk { … }` | Wrapped in `defer(() => …)` so body is not eager at construction |
| Code before first `run` | Lives *inside* the deferred factory (see §3.4) |

---

## 2.3 `bind`

| | |
|---|---|
| **Status** | **Done** (runtime + lowering) |
| **Milestone** | M0 · multi-`run` M2 |

**What it is.** Sequences: run `source`, pass value to continuation, run resulting thunk.

**What it should look like.**

```ts
bind(source, value => succeed(value * 2))
```

**Cases**

| Example | Expected |
|---|---|
| `const x = run op` inside thunk | `bind(op, x => …remainder)` |
| Multiple `run`s | Nested `bind`s (§3.3) |

---

## 2.4 `execute`

| | |
|---|---|
| **Status** | **Done** (runtime + top-level `run`) |
| **Milestone** | M0 · protocol validation M3 |

**What it is.** Outer execution boundary; runs a thunk to a value.

**What it should look like.**

```ts
const result = execute(program)
// or surface: run program   (outside thunk)
```

**Cases**

| Example | Expected |
|---|---|
| Top-level `run program` | Lowers to `execute(program)` |
| `execute` with remaining `Requires` | Must be a compile error once M3 lands |

**Implementation notes.** Runtime `execute` has no environment yet (no `use`/`provide`).

---

# 3. Lowering rules

## 3.1 Basic thunk → `defer` + `succeed`

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | M0 |

**What it is.**

```ts
thunk { return 42 }
```

→

```ts
defer(() => succeed(42))
```

**Cases**

| Example | Expected |
|---|---|
| Pure return | As above |
| Optional optimize to bare `succeed(42)` | Allowed later if proven side-effect free; not required |

---

## 3.2 Single `run` inside thunk

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | M0 |

**What it is.**

```ts
thunk {
  const value = run random
  return value * 2
}
```

→

```ts
defer(() =>
  bind(random, value => succeed(value * 2)),
)
```

**Cases**

| Example | Expected |
|---|---|
| `examples/basic.thunk` | Hover on `value` → `number`; emit contains `defer`/`bind`/`succeed` |

---

## 3.3 Multiple sequential `run`s

| | |
|---|---|
| **Status** | **Partial** (lowerer recurses; needs examples + tests) |
| **Milestone** | **M2** |

**What it is.** Each `run` introduces one `bind`; remainder becomes the continuation.

**What it should look like.**

```ts
thunk {
  const user = run getUser(id)
  const posts = run getPosts(user.id)
  return { user, posts }
}
```

→ nested `bind(getUser(id), user => bind(getPosts(user.id), posts => succeed({ user, posts })))` inside `defer`.

**Cases**

| Example | Expected |
|---|---|
| Two `run`s | Two nested `bind`s; `user` in scope for second operand |
| Three+ `run`s | Same pattern, deeper nesting |
| Editor hover on later binding | Correct TS type from prior binds |

---

## 3.4 Ordinary code before first `run`

| | |
|---|---|
| **Status** | **Partial** (implemented in lowerer; needs dedicated tests) |
| **Milestone** | **M2** |

**What it is.** Eager-looking code before `run` must run when the thunk is *executed*, not when constructed.

**What it should look like.**

```ts
thunk {
  const started = Date.now()
  const user = run getUser()
  return { user, started }
}
```

→

```ts
defer(() => {
  const started = Date.now()
  return bind(getUser(), user => succeed({ user, started }))
})
```

**Cases**

| Example | Expected |
|---|---|
| Construct `program` without `run program` | `Date.now()` must **not** run |
| `run program` / `execute(program)` | `Date.now()` runs once, then binds |

---

## 3.5 Ordinary code between `run`s

| | |
|---|---|
| **Status** | **Partial** (falls out of recursive body emit; needs tests) |
| **Milestone** | **M2** |

**What it is.** Statements between `run`s stay inside the continuation of the previous `bind`.

**What it should look like.**

```ts
thunk {
  const user = run getUser()
  const name = normalize(user.name)
  const posts = run getPosts(user.id)
  return { name, posts }
}
```

**Cases**

| Example | Expected |
|---|---|
| `normalize(user.name)` between runs | Inside first continuation, before second `bind` |
| Mutation / locals between runs | Captured by later continuations via closures |

---

## 3.6 Variable capture / lexical scope

| | |
|---|---|
| **Status** | **Partial** (relies on JS closures in emit; needs examples) |
| **Milestone** | M0/M2 |

**What it is.** Continuations must see outer locals (`prefix`, `started`, etc.).

**Cases**

| Example | Expected |
|---|---|
| `const prefix = "user:"` then `run getUser()` then `return prefix + user.name` | Generated continuation closes over `prefix` |

---

## 3.7 `run` only in statement position (restriction)

| | |
|---|---|
| **Status** | **Done** (restriction enforced) |
| **Milestone** | M0 · relax later |

**What it is.** Initial language forbids `run` in arbitrary expression positions.

**Cases**

| Example | Expected |
|---|---|
| `const user = run getUser()` | Supported |
| `return (run getUser()).name` | Unsupported — rewrite to bind then use `.name` |
| `run` in `while (…)` condition | Unsupported |

---

# 4. `run` semantics

## 4.1 One-layer removal (no auto-flatten)

| | |
|---|---|
| **Status** | **Partial** (semantic intent; nested `Thunk<Thunk<T>>` not typed yet) |
| **Milestone** | M0 behavior for single layer · types M3 |

**What it is.** Each `run` peels exactly one thunk layer.

**Cases**

| Example | Expected |
|---|---|
| `run tx` where `tx: Thunk<Thunk<T>>` | Result `Thunk<T>` |
| `run (run tx)` | Result `T` |
| No automatic recursive flatten | Must write nested `run`s |

---

## 4.2 `run` inside a thunk → `bind`

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | M0 |

See §2.3 / §3.2.

---

## 4.3 `run` outside a thunk → `execute`

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | M0 |

**Cases**

| Example | Expected |
|---|---|
| Top-level `run program` | `execute(program)` |
| Expression-statement `run foo` | Same |

---

## 4.4 Nested `run` expressions

| | |
|---|---|
| **Status** | **Not started** / limited |
| **Milestone** | After statement-position solidify |

**What it should look like.**

```ts
const value = run (run tx)
```

**Cases**

| Example | Expected |
|---|---|
| Nested `run` as expression | Two sequencing ops (LANGUAGE §7.4) |
| Current parser | `run` operand parsing is limited; prefer statement form for now |

---

# 5. Pipe syntax

## 5.1 Basic pipe

| | |
|---|---|
| **Status** | **Not started** |
| **Milestone** | **M2** |

**What it is.** Ordinary expression transform: `value \| transform` → `transform(value)`. Not thunk-specific.

**What it should look like.**

```ts
value | transform
```

**Cases**

| Example | Expected |
|---|---|
| `x \| double` | `double(x)` |
| Works on non-thunks | Yes |

---

## 5.2 Pipe with extra arguments

| | |
|---|---|
| **Status** | **Not started** |
| **Milestone** | **M2** |

**What it should look like.**

```ts
value | transform(a, b)
```

→

```ts
transform(value, a, b)
```

**Cases**

| Example | Expected |
|---|---|
| `tx \| flatten(1)` | `flatten(tx, 1)` |

---

## 5.3 Pipe precedence with `run`

| | |
|---|---|
| **Status** | **Not started** |
| **Milestone** | **M2** |

**What it is.** Pipe binds tighter than `run`: `run tx \| f` means `run (tx \| f)`.

**Cases**

| Example | Expected |
|---|---|
| Inside thunk: `const v = run tx \| flatten(1)` | `bind(flatten(tx, 1), v => …)` |
| Outside thunk: `const v = run tx \| flatten(1)` | `execute(flatten(tx, 1))` |

---

# 6. Protocol system

## 6.1 Postfix protocol bag on types

| | |
|---|---|
| **Status** | **Done** (encoding + pretty-print + `.thunk` postfix parse/lower) |
| **Milestone** | M3 |

**What it is.**

```ts
Thunk<User>
  Requires(Database | Logger)
  Once
```

**Cases**

| Example | Expected |
|---|---|
| Multiple postfix entries | One bag; duplicates merge per protocol |
| Hover | Pretty-printer shows postfix form from `Thunk<T, ProtocolBag<…>>` encoding |
| Writing postfix in `.thunk` | Parsed and lowered to `Thunk<T, { [Requires]: … }>` |

---

## 6.2 Protocol bag normalization

| | |
|---|---|
| **Status** | **Done** for `Requires` (`MergeProtocols` / postfix encode merge) |
| **Milestone** | Typed core + postfix |

**What it is.** Protocol-aware merge — **not** TS intersection of duplicate keys.

**Cases**

| Example | Expected |
|---|---|
| `Requires(A)` + `Requires(B)` | `Requires(A \| B)` via `RequiresBind` / `MergeProtocols` |
| Different protocols | Other keys intersected; `Requires` special-cased |

---

## 6.3 `protocol` declarations

| | |
|---|---|
| **Status** | **Partial** — parse + lower to `Name_bind` / `Name_execute` type aliases |
| **Milestone** | M3 |

**What it should look like.**

```ts
protocol Requires<Tags extends Tag<any>> {
  bind<A, B>: A | B;
  execute<A>: A extends never ? never : CompileError<`…`>;
}
```

**Cases**

| Example | Expected |
|---|---|
| `bind<A, B>: A \| B` (no `()`) | Type function, not a method |
| Payload constraint | Implicitly constrains type-function params |

---

## 6.4 Protocol type functions on atomic ops

| | |
|---|---|
| **Status** | **Partial** — hard-coded `Requires` via `bind` / `succeed` / `defer` / `execute` signatures |
| **Milestone** | Type-level now · general `protocol` declarations **M3** |

**What it is.** Each protocol may define `succeed` / `defer` / `bind` / `execute` type functions over **its own payload only**.

**Cases**

| Example | Expected |
|---|---|
| `RequiresBind<Database, Logger>` | `Database \| Logger` |
| `bind(thunkA, cont)` | Return type uses `MergeProtocols` |
| Protocol does not see return type / other protocols | Enforced by bag merge helpers |

---

## 6.5 Inherited defaults (`succeed<>` / `defer<A>`)

| | |
|---|---|
| **Status** | **Done** (in runtime signatures) |
| **Milestone** | Typed core |

**Decision.** `succeed` → empty bag; `defer` preserves `P`; absent `Requires` ≡ `never`.

---

## 6.6 Protocol inference through lowering

| | |
|---|---|
| **Status** | **Partial** — falls out of typed `bind` when operands carry bags; no `use` yet to introduce them in source |
| **Milestone** | **M3–M4** |

**What it is.** Infer bag by applying protocol type functions along generated `bind` / `succeed` / `defer` / `execute`.

**Cases**

| Example | Expected |
|---|---|
| `run use(Database)` then `run use(Logger)` then `succeed(…)` | `Requires(Database \| Logger)` on result |
| Binding `Requires(Database) Once` to `Requires(Logger)` | Requires merge + independent `Once.bind` |

---

## 6.7 Partial protocol matching

| | |
|---|---|
| **Status** | **Not started** (design resolved: yes) |
| **Milestone** | **M3–M4** |

**Cases**

| Example | Expected |
|---|---|
| `Th extends Thunk<any> Requires(P)` | Matches thunks that also have `Once`, etc. |

---

## 6.8 Higher-order protocol type functions

| | |
|---|---|
| **Status** | **Deferred** (design influence only) |
| **Milestone** | After first `Requires` |

See LANGUAGE §16. Must not block M3 `Requires`.

---

# 7. `Requires`, tags, environment

## 7.1 `Requires` protocol

| | |
|---|---|
| **Status** | **Done** (type-level + postfix + `use`/`provide`) |
| **Milestone** | M3–M4 |

**What it is.** Accumulate requirements on `bind`; reject `execute` if payload ≠ `never`.

**Cases**

| Example | Expected |
|---|---|
| `ExecuteResult<T, EmptyProtocols>` | `T` |
| `ExecuteResult<T, WithRequires<Database>>` | `CompileError<\`Unsatisfied requirements\`>` |
| Pure `succeed(1)` | No requirements |
| `examples/requires.thunk` | `use` + `provide` + `run` |

---

## 7.2 `symbol` (branding + Requires tags)

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | M4 |

**What it should look like.**

```ts
symbol Age = number
symbol Database { name: string }

const a: Age = Age(30)
const db = run use(Database)
```

**Cases**

| Example | Expected |
|---|---|
| `Age(30)` | Brands; `number` assignable from `Age`; reverse rejected |
| `typeof Database` | Symbol identity; `SymbolType<typeof Database>` is associated type |
| `use` / `layerOf` / `provide` | Env keyed by `Database.key`; Requires payload is identity |
| `createTag` | Deprecated / not part of the surface (lowerer uses `__makeSymbol`) |

---

## 7.3 `use`

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | M4 |

**What it should look like.**

```ts
function use<S extends ThunkSymbol<any>>(sym: S): Thunk<SymbolType<S>> Requires(S)
```

**Cases**

| Example | Expected |
|---|---|
| `use(Database)` | Thunk that reads env; type introduces `Requires(Database)` |
| Requirement | Declared on signature — not inferred from runtime body |

---

## 7.4 `Layer`

| | |
|---|---|
| **Status** | **Done** (`layerOf` / `mergeLayers`) |
| **Milestone** | M4 |

**What it should look like.**

```ts
layerOf(Database, liveDatabase)
```

**Cases**

| Example | Expected |
|---|---|
| Provide layer | Scoped child environment; parent unchanged |

---

## 7.5 `provide`

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | M4 |

**What it should look like.**

```ts
provide(thunk, layer)  // removes provided Requires; preserves other protocols
```

**Cases**

| Example | Expected |
|---|---|
| Input `Requires(Database \| Logger)` + `Layer<Database>` | `Requires(Logger)` (type-level `ProvideRequires`) |
| Runtime | Extend env, run inner, restore |

---

## 7.6 Runtime environment / `use` & `provide` nodes

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | M4 |

Tagged nodes: `succeed` \| `defer` \| `bind` \| `use` \| `provide` with `Map` environment.

---

# 8. Type utilities

## 8.1 `Protocol<T>`

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | Typed core |

Extract protocol bag from a thunk type. Exists in `@thunk/types`.

---

## 8.2 `Strip<T>`

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | Typed core |

`Thunk<User> Requires(…) Once` → `Thunk<User>`.

---

## 8.3 `ThunkReturnType<T>` (thunk)

| | |
|---|---|
| **Status** | **Done** (`ThunkReturnType`; deprecated alias `ReturnType`) |
| **Milestone** | Typed core |

Extract produced value type.

---

## 8.4 `Omit` / `OmitProtocol`

| | |
|---|---|
| **Status** | **Done** (`OmitProtocol`) |
| **Milestone** | Typed core |

Remove one protocol entry from a bag.

---

## 8.5 `CompileError<Message>`

| | |
|---|---|
| **Status** | **Done** (used by `ExecuteResult`) |
| **Milestone** | Typed core |

Marker type for failed `execute` validation.

---

## 8.6 Get/Set/Remove protocol helpers

| | |
|---|---|
| **Status** | **Not started** |
| **Milestone** | Later |

Conceptual `GetProtocol` / `SetProtocol` / `RemoveProtocol` — provisional API.

---

# 9. Tooling (editor / CLI)

## 9.1 Parse → lower → source maps

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | M0 |

**Cases**

| Example | Expected |
|---|---|
| Map `value` in `.thunk` | Hits generated bind parameter |
| Most-specific overlap | Source-map resolver behavior |

---

## 9.2 Editor hover / diagnostics (Volar)

| | |
|---|---|
| **Status** | **Done** (M0 subset) |
| **Milestone** | M1 |

**Cases**

| Example | Expected |
|---|---|
| Hover `value` in `basic.thunk` | Mentions `number` |
| Type error in body | Diagnostic on `.thunk` position |
| Parse error | Diagnostic; LS stays up |

---

## 9.3 CLI emit (`thunk build`)

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | M1 |

**Cases**

| Example | Expected |
|---|---|
| `bun run thunk -- build examples/basic.thunk` | Writes sibling `.thunk.ts` via same lowerer |

---

## 9.4 Pretty-print postfix protocols in hover

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | Typed core |

Show `Thunk<T> Requires(A)` instead of raw encoding when possible. Empty bags → `Thunk<T>` only. Wired in `createThunkProject` and Volar TS hover wrap.

---

## 9.5 TextMate / language configuration

| | |
|---|---|
| **Status** | **Done** (minimal) |
| **Milestone** | M1 |

Keywords `thunk` / `run` / `return` / `const` / `let`; `//` comments. Expand when `protocol` / `|` ship.

---

# 10. Explicitly deferred features

These must **not** drive the initial core. Status for all: **Deferred**.

| Feature | Notes |
|---|---|
| Typed error channels / error handling semantics | Later protocol or ops |
| Cancellation | Later |
| Asynchronous execution | Later |
| Concurrency / parallel composition | Later |
| Resource scopes / ownership / linear usage | Later |
| Synchronization / locking | Later |
| Actor systems | Later |
| Effect tracking beyond `Requires` | Later |
| Advanced protocol interoperability | Later |
| `run` in arbitrary expressions / full CFG | After solid statement-position lowering |
| Iterative executor (stack) | Runtime polish after recursive prototype |
| Disk `.map` sourcemaps for emit | Optional tooling |
| `.th.ts` alternate extension | Open; not required |

---

# Summary matrix

| Feature | Status | Target |
|---|---|---|
| `thunk { }` | Done | M0 |
| Explicit `return` | Done | M0 |
| Ordinary statements (basic) | Partial | M0+ |
| Hybrid TS expressions | Partial | M0+ |
| `Thunk<T>` surface typing | Done (carrier + hover) | Typed core |
| `succeed` / `defer` / `bind` / `execute` runtime | Done (returns `Thunk`) | M0 / typed core |
| Single-`run` lowering | Done | M0 |
| Multi-`run` lowering | Partial | **M2** |
| Code before / between `run` | Partial | **M2** |
| Lexical capture | Partial | M2 |
| `run` statement-position only | Done (restriction) | M0 |
| Nested `run` expressions | Limited | later |
| Pipe `\|` | Not started | **M2** |
| Pipe + `run` precedence | Not started | **M2** |
| Postfix protocol syntax | Done | M3 |
| Protocol normalization / inference | Done (`Requires`) | M3 |
| `protocol` declarations | Partial (aliases emitted) | M3 |
| `Requires` + `CompileError` on execute | Done | M3–M4 |
| `symbol` / `use` / `Layer` / `provide` | Done | M4 |
| Type utilities | Done | Typed core |
| Volar editor + CLI | Done | M1 |
| Hover pretty protocols | Done (empty `Omit<>` fixed) | Typed core |
| Errors / async / concurrency / resources / … | Deferred | later |

**Next implementation focus:** M2 (pipes / multi-`run` hardening); deepen `protocol` decls so generated type functions drive merge instead of hard-coded `Requires` only.
