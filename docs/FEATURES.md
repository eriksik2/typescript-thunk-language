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
| Nested `thunk` in object / arrow / call args | Allowed; hybrid parser embeds and lowers |

**Implementation notes.** Parsed as `ThunkExpression`; lowered to `defer(() => …)`. Nested forms inside opaque TS regions are `TsExpression` parts (`embedded`), not left as raw `thunk` text.

See [language-reference/core/thunk-blocks.md](./language-reference/core/thunk-blocks.md).

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
| `for` / `while` / `if` containing **no** `run` | Ordinary JS inside `defer` |
| `for` / `while` / `if` / `break` / `continue` **with** `run` | State-machine transitions — see [`examples/control-flow.thunk`](../examples/control-flow.thunk) |
| `run` inside loop condition / `finally` | **Unsupported** initially — see LANGUAGE §17.3 |
| `try` / `catch` / `finally` | **Out of scope** for now |

**Implementation notes.** `const`/`let`, expression statements, `if`/`else`, `while`, C-style `for`, `break`, and `continue` are parsed. With `run`, they lower through the state machine. `try`/`catch`/`finally` remain deferred.

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
| `run db.getUser("1234")` | Full member-call operand (await-like) |
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
| Nested `Thunk<Thunk<boolean, { [Async]: void }>>` | Pretty-prints `Thunk<Thunk<boolean> Async>` |
| `Thunk<T> Requires(X)` / `Async` → plain `Thunk<T>` | **Not** assignable (protocol bag invariant) |
| Runtime | Tagged nodes cast to `Thunk<T, P>` at API boundary (`@thunk/runtime`) |

**Implementation notes.** [`packages/types`](../packages/types/src/index.ts) defines `Thunk<T, P>` with an invariant protocol marker so `EmptyProtocols` (`{}`) cannot absorb nonempty bags. Runtime primitives return `Thunk`. Language-service pretty-prints hover (including nested thunks and trailing-`;` bags from the TS printer).

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

## 2.3 `bind` (hand-written) / `runEffect` + `machine` (lowering)

| | |
|---|---|
| **Status** | **Done** (runtime + state-machine lowering) |
| **Milestone** | M0 · multi-`run` / control-flow M2 |

**What it is.** Sequencing: run a source thunk, continue with its value. The lowerer emits an iterative state machine (`runEffect` / `machine`); `bind` remains for hand-written runtime use.

**What it should look like.**

```ts
// Emitted shape (simplified)
machine(function (resume) {
  switch (state) {
    case 0:
      state = 1
      return runEffect(source)
    case 1:
      value = resume
      return succeed(value * 2)
  }
})
```

**Cases**

| Example | Expected |
|---|---|
| `const x = run op` inside thunk | `runEffect(op)` then resume into `x` |
| Multiple `run`s | Multiple states in one machine (§3.3) |

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
defer(() => {
  let state = 0
  let value
  return machine(function (resume) {
    switch (state) {
      case 0:
        state = 1
        return runEffect(random)
      case 1:
        value = resume
        return succeed(value * 2)
    }
  })
})
```

**Cases**

| Example | Expected |
|---|---|
| `examples/basic.thunk` | Hover on `value` → `number`; emit contains `defer`/`machine`/`runEffect`/`succeed` |

---

## 3.3 Multiple sequential `run`s

| | |
|---|---|
| **Status** | **Done** (state machine; examples + surface tests) |
| **Milestone** | **M2** |

**What it is.** Each `run` advances the state machine and suspends via `runEffect`; resume continues at the next state with hoisted locals.

**What it should look like.**

```ts
thunk {
  const user = run getUser(id)
  const posts = run getPosts(user.id)
  return { user, posts }
}
```

→ one `machine` with states for each `run`, not nested `bind`s.

**Cases**

| Example | Expected |
|---|---|
| Two `run`s | Two `runEffect` sites; `user` in scope for second operand |
| Three+ `run`s | Same pattern, more states |
| Editor hover on later binding | Correct TS type from resume witnesses |

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
  let state = 0
  let started
  let user
  return machine(function (resume) {
    switch (state) {
      case 0:
        started = Date.now()
        state = 1
        return runEffect(getUser())
      case 1:
        user = resume
        return succeed({ user, started })
    }
  })
})
```

**Cases**

| Example | Expected |
|---|---|
| Construct `program` without `run program` | `Date.now()` must **not** run |
| `run program` / `execute(program)` | `Date.now()` runs once, then effects |

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

## 3.7 `run` in statement and expression position

| | |
|---|---|
| **Status** | **Done** (statement + ANF for expression position) |
| **Milestone** | M0 statement · **M2** ANF |

**What it is.** Statement-position `run` lowers directly. Expression-position `run` is normalized to `const __rN = run …` (ANF) before machine lowering. See [language-reference/core/run.md](./language-reference/core/run.md) and [pipe.md](./language-reference/core/pipe.md).

**Cases**

| Example | Expected |
|---|---|
| `const user = run getUser()` | Supported |
| `const user = run db.getUser(id)` | Supported (full expression operand, like `await`) |
| `return run provide(t, layer)` | Supported → `runEffect(…)` then `succeed(__resume)` |
| `return (run getUser).name` | Supported via ANF (`__rN` then `.name`) |
| `run` in `while (…)` condition | Supported — re-evaluated each iteration |

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

## 4.2 `run` inside a thunk → state machine (`runEffect` / `machine`)

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

## 4.4 Nested `run` / full operands

| | |
|---|---|
| **Status** | **Done** (operand = full expression; nested `run run x` parses) |
| **Milestone** | M0+ |

**What it should look like.**

```ts
const user = run db.getUser("1234")
const value = run (run tx)
return run provide(fetchUser, db)
```

`run` is await-like for its **operand** (member access, calls, nested `thunk` / `run`, pipe). Statement and expression positions are supported; expr-position uses ANF (§3.7).

See [language-reference/core/run.md](./language-reference/core/run.md).

---

# 5. Pipe syntax

## 5.1 Basic pipe

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | **M2** |

**What it is.** Ordinary expression transform: `value \| transform` → `transform(value)`. Not thunk-specific. See [language-reference/core/pipe.md](./language-reference/core/pipe.md).

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
| **Status** | **Done** |
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
| **Status** | **Done** |
| **Milestone** | **M2** |

**What it is.** Pipe binds tighter than `run`: `run tx \| f` means `run (tx \| f)`. Expression-position `run` uses ANF before machine lowering.

**Cases**

| Example | Expected |
|---|---|
| Inside thunk: `const v = run tx \| flatten(1)` | `runEffect(flatten(tx, 1))` then resume |
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
| **Status** | **Done** (hierarchy / abstract: Done) |
| **Milestone** | M4 · hierarchy post-M4 |

**What it should look like.**

```ts
symbol Age = number
symbol Database { name: string }

abstract symbol Failure { message: string }
symbol Defect extends Failure

const a: Age = Age(30)
const db = run use(Database)
```

**Cases**

| Example | Expected |
|---|---|
| `Age(30)` | Brands; `number` assignable from `Age`; reverse rejected |
| `typeof Database` | Symbol identity; `SymbolType<typeof Database>` is associated type |
| `use` / `layerOf` / `provide` / `Symbol.of` | Env keyed by identity; branded objects retain identity |
| `abstract symbol` | Not callable; still a type / `Symbol.has` / `Symbol.to` target |
| `symbol Child extends Parent` | Pedigree for `has` / `to`; **no** value assignability to Parent; env keys stay exact |
| `createTag` | Deprecated / not part of the surface (lowerer uses `__makeSymbol`) |

Built-in Failure tree: see [`language-reference/symbols/failure-hierarchy.md`](./language-reference/symbols/failure-hierarchy.md).

---

## 7.3 `use`

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | M4 |

**What it should look like.**

```ts
import { use } from "@thunk/runtime"

function use<S extends ThunkSymbol<any>>(sym: S): Thunk<SymbolType<S>> Requires(S)
```

Authors must import value APIs from `@thunk/runtime`. The type `Thunk<T>` is auto-available (lowerer injects it).

**Cases**

| Example | Expected |
|---|---|
| `use(Database)` | Thunk that reads env; type introduces `Requires(Database)` |
| Missing import | TS cannot find name `use` |
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
import { provide, layerOf } from "@thunk/runtime"

provide(fetchUser, DatabaseLive)               // branded object (Symbol.of)
provide(fetchUser, layerOf(Database, impl))  // layer form
```

See [language-reference/environment/provide.md](./language-reference/environment/provide.md).

**Cases**

| Example | Expected |
|---|---|
| `provide(thunk, DatabaseLive)` | Discharges `Requires(Database)` |
| `Requires(Database \| Logger)` + `Layer<Database>` | `Requires(Logger)` |
| Runtime | Extend env, run inner, restore |

---

## 7.6 Runtime environment / `use` & `provide` nodes

| | |
|---|---|
| **Status** | **Done** |
| **Milestone** | M4 |

Tagged nodes: `succeed` \| `defer` \| `bind` \| `use` \| `provide` with `Map` environment.

---

## 7.7 `Async` + `wrap`

| | |
|---|---|
| **Status** | **Done** (MVP) |
| **Milestone** | post-M4 |

**What it should look like.**

```ts
import { wrap } from "@thunk/runtime"

const program = thunk {
  const n = run wrap(() => Promise.resolve(1))
  return n + 1
}

const result: Promise<number> = run program
```

**Cases**

| Example | Expected |
|---|---|
| `wrap(() => Promise.resolve(x))` | `Thunk<typeof x> Async` |
| `execute` / top-level `run` of Async thunk | `Promise<T>` |
| Sync thunk `execute` | still plain `T` |
| Promise rejection | throws branded `UnhandledError` |
| Machine with `run wrap(...)` | collapses `Async` onto the machine type |

See [language-reference/core/wrap.md](./language-reference/core/wrap.md), [language-reference/types/async.md](./language-reference/types/async.md).

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
| Typed error channels / error handling semantics | Fail **protocol** still later; **Result values + match v1** shipped; Failure tree + `wrap` → `UnhandledError` |
| Cancellation | Later |
| Asynchronous execution | **Partial** — `Async` + `wrap` + async `execute` |
| Concurrency / parallel composition | Later |
| Resource scopes / ownership / linear usage | Later |
| Synchronization / locking | Later |
| Actor systems | Later |
| Effect tracking beyond `Requires` | Partial — `Async` flag shipped; more later |
| Advanced protocol interoperability | Later |
| `run` in arbitrary expressions / full CFG | **Done** (ANF); `for`-condition nested `run` still once-before-loop |
| `try` / `catch` / `finally` in thunks | Separate design (handler/finalizer state) |
| Iterative executor (stack) | Largely addressed by machine lowering; further polish optional |
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
| `succeed` / `defer` / `runEffect` / `machine` / `execute` runtime | Done (`bind` kept for hand-written) | M0 / typed core |
| Single-`run` lowering | Done (state machine) | M0 |
| Multi-`run` lowering | Done (state machine) | **M2** |
| Code before / between `run` | Partial | **M2** |
| Lexical capture | Partial | M2 |
| `run` statement + expression (ANF) | Done | M0 / **M2** |
| Nested `run` expressions | Done (ANF) | **M2** |
| Pipe `\|` | Done | **M2** |
| Pipe + `run` precedence | Done | **M2** |
| `match` (exact leaf + exhaustiveness) | Done (v1) | **M2** |
| `is` pattern test (`if (x is Err: infer e)`) | Done | **M2** |
| `Result` / `Ok` / `Err` | Done (values) | **M2** |
| Generic `symbol Name<A>` | Done | **M2** |
| Postfix protocol syntax | Done | M3 |
| Protocol normalization / inference | Done (`Requires`) | M3 |
| `protocol` declarations | Partial (aliases emitted) | M3 |
| `Requires` + `CompileError` on execute | Done | M3–M4 |
| `symbol` / `use` / `Layer` / `provide` | Done | M4 |
| Type utilities | Done | Typed core |
| Volar editor + CLI | Done | M1 |
| Hover pretty protocols | Done (empty `Omit<>` fixed) | Typed core |
| Errors / async / concurrency / resources / … | Partial (`Async`+`wrap`; Failure; **Result+match**) | later |

**Next implementation focus:** deepen `protocol` decls; typed Fail protocol on thunks (optional next after Result values); match v2 (literals / guards).
