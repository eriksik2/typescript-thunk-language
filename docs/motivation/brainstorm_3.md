# Concurrency, interruption, scopes, and sync — in the Thunk way

**Status:** Design brainstorm (not a commitment).  
**Context:** Effect-style runtime ideas (`Fiber`, `fork`/`all`/`race`, interruption, `Scope`, `Ref`/`Queue`/`Semaphore`/`Deferred`, parallel composition) mapped onto Thunk’s existing surface: imperative `thunk { }` + `run`, protocol bags, `Fail(E)`, machine lowering, `Requires` / `provide`.

These are explicitly deferred in [`LANGUAGE.md`](../LANGUAGE.md) §21 and [`FEATURES.md`](../FEATURES.md) §10. The question here is not “should we ship Effect,” but **which invariants deserve language kinds**, and how they stay *imperative and natural* rather than library-shaped.

---

## The Thunk litmus

Thunk’s win so far is: write straight-line code, get a typed deferred computation.

```ts
const program = thunk {
  const user = run getUser(id)
  const posts = run getPosts(user.id)
  return { user, posts }
}
```

Effect’s win is: the same computation can also mean *fork children, cancel siblings, release resources, race deadlines* — with types that track error channels and requirements.

The risk is bolting on `Effect.fork` / `Fiber.join` as a second dialect. The opportunity is treating concurrency the way `run` treated sequencing: **syntax + protocols + lowering**, so the programmer still writes statements, and the illegal shapes don’t typecheck.

Filter (same as brainstorm_2):

1. Is the invariant **global**? → language/types.
2. Does it cross **process or time**? → identity + durability later; for now, fiber lifetime.
3. Would a wrong implementation still typecheck in TS today? → that’s the gap.
4. Can one declaration lower to runtime *and* stay readable as `thunk` bodies?

---

## Mental model: one fiber is just “a running thunk”

Today a thunk is inert until `run` / `execute`. Concurrency needs a name for *an already-started execution*:

| Effect | Thunk-shaped reading |
|---|---|
| `Effect<A, E, R>` | `Thunk<A> Fail(E) Requires(R)` (+ maybe `Async`) |
| Fiber | A **live handle** to a started thunk: join / interrupt / await exit |
| Runtime | The executor that already drives `machine` / `runEffect` |

So:

- **Thunk** = recipe (still inert, still the value you compose).
- **Fiber** = recipe *plus* identity of a running instance (like a Promise, but with structured parent/child and interruption).

You should almost never need to *think* “fiber” in ordinary code — the same way you don’t think “continuation” when you write `run`. Fibers show up when you **detach**, **join**, or **race**.

```ts
// conceptual surface — not committed syntax
const program = thunk {
  const user = run getUser(id)          // sequential, same fiber
  const handle = fork getPosts(user.id) // child fiber; returns Fiber<…>
  const posts = run join handle         // await child; interruption propagates
  return { user, posts }
}
```

`fork` / `join` are the escape hatches. Everyday parallel work should look more like structured blocks (below).

---

## 1. Structured concurrency (`all`, `race`, …) as *blocks*, not combinators

### Pain if we copy Effect literally

```ts
Effect.all([getUser(id), getPosts(id)])
Effect.race(fetchA, fetchB)
```

Fine in a combinator library; alien next to `thunk { const x = run … }`.

### Thunk-shaped answer

Parallelism as **regions** that desugar to the same runtime ops, but keep statement style:

```ts
const page = thunk {
  const [user, posts] = run all {
    getUser(id)
    getPosts(id)
  }
  return { user, posts }
}
```

Or statement form with named bindings (often nicer):

```ts
const page = thunk {
  parallel {
    const user = run getUser(id)
    const posts = run getPosts(id)
  }
  return { user, posts }   // both in scope after the block
}
```

**Semantics (structured):**

- Entering the block forks children (or schedules them on the same supervisor).
- Exiting successfully joins all.
- If any fails with `Fail(E)`, siblings are **interrupted**, then the failure is re-raised (or merged — pick one rule and stick to it).
- Leaving the block without joining is a **type/scope error** (no orphan fibers).

`race` as a region:

```ts
const first = run race {
  fetchPrimary()
  fetchBackup()
}
// loser interrupted automatically
```

`all` / `race` / `parallel` are **one clear way** (brainstorm_1 §2): opinionated desugaring to fork+join+interrupt, with fixed failure and cancellation policy. Library authors can still expose low-level `fork` for exotic supervisors; application code defaults to regions.

### Protocol / type composition

Same merge laws you already have:

| Dimension | Rule of thumb |
|---|---|
| Yield | tuple / first / chosen arm |
| `Fail(E)` | union of arms (like sequential `try`) |
| `Requires` | union of arms (`RequiresBind`) |
| `Async` | present if **any** arm has it |

That keeps concurrency inside the existing bag model instead of inventing `Effect<A,E,R>` as a parallel universe.

---

## 2. Interruption / cancellation — as a protocol + runtime law, not `AbortSignal` folklore

### What Effect got right

Interruption is **cooperative but checked**: fibers check interrupt status between steps; finalizers still run; “uninterruptible” regions exist for critical sections.

### What Thunk already has that maps

- The **state machine** is already a suspension points API (`runEffect` between states). Interrupt checks belong *between* machine steps — nearly free if the executor owns them.
- `Fail(E)` is the *typed* channel. Interruption should **not** be a random `Error` you forget to handle; it’s either:
  - a distinguished failure arm (`Interrupt` under the Failure tree), or
  - a **separate exit cause** (Effect’s `Exit` / `Cause`) that `join` surfaces.

Recommendation for Thunk: keep application `Fail(E)` clean; model interruption as **exit metadata** on fiber join, and only inject `Interrupt` into yield when the author explicitly `try`s / matches it. Swallowing cancel by accident should be hard.

### Surface that stays imperative

```ts
const work = thunk {
  const handle = fork longJob()
  // … later
  interrupt handle
  const exit = run awaitExit handle   // Success | Fail(E) | Interrupted
  return exit
}
```

Timeouts as structured race (not a separate cancel API):

```ts
const result = run race {
  fetchUser(id)
  timeout(5_000)   // loses → interrupt sibling; Fail(Timeout) or Interrupt policy
}
```

### Protocol angle: `Interruptible` / `Uninterruptible`

Like `Async`, a flag protocol:

```ts
Thunk<void> Uninterruptible   // critical section; mask interrupts until exit
```

Or a block:

```ts
thunk {
  uninterruptible {
    const conn = run acquireConn()
    run conn.commit()
  }
}
```

Lowering: mask bit on the fiber while inside the region; still run finalizers on scope exit.

**Global invariant:** you cannot “forget cancellation” the way you forget `AbortSignal` plumbing — every forked child is tied to a scope (next section), and interrupt is the default on scope failure/exit.

---

## 3. `Scope` + acquire/release — finalizers as *owned* by a region

LANGUAGE already hints at this:

> `scope:` Transform resource ownership.

`provide` already pushes/pops an environment layer. Scope is the same *shape* for **lifetimes**:

```ts
const program = thunk {
  scope {
    const db = run acquire(Database)      // registers release finalizer
    const user = run db.getUser(id)
    return user
  }  // db released here — success, fail, or interrupt
}
```

Or Effect-like `acquireRelease` as a library function that *requires* an ambient scope:

```ts
function acquireRelease<A, E>(
  acquire: Thunk<A> Fail(E),
  release: (a: A) => Thunk<void>,
): Thunk<A> Fail(E) Requires(Scope)
```

Then:

```ts
const db = run acquireRelease(openDb, closeDb)  // Needs Scope
```

Discharging `Requires(Scope)`:

- explicit `scope { … }` / `scoped(thunk)`, or
- top-level `execute` providing a root scope (like a root fiber).

### Why this is language-shaped (not just a library)

1. **Finalizers must run** on every exit path — including interrupt. That’s executor law, not try/finally sugar (JS `finally` is deferred in FEATURES for a reason; Scope *is* the designed finalizer state).
2. **Orphan prevention:** `fork` without a scope is either forbidden or auto-attaches to the current scope (structured by default; “daemon” / detached is opt-in and loud).
3. **Ownership protocol:** a value acquired in scope A cannot be returned past scope A unless explicitly `transfer`ed — optional later, linear-ish; even without linearity, *finalizers* alone buy most production safety.

Natural pairing with layers:

| Mechanism | What it scopes |
|---|---|
| `provide` / `Layer` | *Who* you can `use` (capabilities) |
| `Scope` | *How long* resources live (finalizers) |

A DB layer’s construction often *is* acquire/release inside a scope; `Layer` and `Scope` should compose, not compete.

```ts
// sketch: layer construction is scoped
const DatabaseLive = layer {
  const pool = run acquireRelease(openPool, closePool)
  return Database({ query: … })
}
```

---

## 4. Sync primitives — ordinary values, effectful ops

`Ref`, `Queue`, `Semaphore`, `Deferred`, `Latch`, … should feel like **runtime types**, not a second effect system.

```ts
const counter = run Ref.make(0)

thunk {
  run counter.update(n => n + 1)
  const n = run counter.get
  return n
}
```

```ts
const done = run Deferred.make<User, NotFound>()

// fiber A
run done.succeed(user)

// fiber B
const user = try done.await
```

```ts
const lim = run Semaphore.make(4)
run lim.withPermits(1)(thunk {
  return run hitApi()
})
```

```ts
const q = run Queue.unbounded<Job>()
run q.offer(job)
const job = run q.take
```

### Design rules so they stay “Thunk-native”

1. **Constructors are thunks** (`Ref.make` → `Thunk<Ref<A>>`), often `Async`-free and requirement-free.
2. **Operations are thunks** (`ref.get` → `Thunk<A>`), so they compose with `run` / `try` / machines without special casing.
3. **No ambient mutability outside fibers:** a `Ref` is shareable across fibers by design; a plain `let` in a thunk body is fiber-local (already true). Teach that distinction; don’t try to make `let` transactional.
4. **Backpressure & interrupts:** `Queue.take` / `Deferred.await` are natural interrupt points — same cooperative model as `runEffect`.
5. **Protocols only when needed:** e.g. `Queue.offer` might stay pure-capability; something like “needs STM” or “needs exclusive key” can be a `Requires` later. Don’t stamp every primitive with a protocol on day one.

These are mostly **library + runtime**, not new syntax — *except* where syntax prevents misuse (e.g. `withPermits` as a block that can’t forget release):

```ts
permit(lim, 1) {
  run hitApi()
}
```

Same pattern as `scope` / `uninterruptible`: **regions for brackets**.

---

## 5. Parallel composition — the everyday API

Collapse the design space to a small closed set:

| Form | Meaning | Failure | Cancel |
|---|---|---|---|
| sequential `run` | one fiber | first `Fail` via `try` / yield | N/A |
| `all` / `parallel` | wait for all | fail-fast + interrupt siblings (default) | structured |
| `race` | first success or first decisive exit | policy choice | losers interrupted |
| `fork` + `join` | explicit lifetime | on join | manual / scope |
| `foreachPar` / bounded | collection fan-out | same as `all` | + semaphore |

Example that should feel boring:

```ts
const report = thunk {
  const ids = run loadIds()
  const users = run foreachPar(ids, 8, id => getUser(id))
  return users
}
```

Under the hood: scope + semaphore + fork/join. On the surface: one verb, one concurrency limit, same `Fail` / `Requires` merge.

**Zip without concurrency** already exists in spirit (`zip` in legacy `src/`); keep **product of values** separate from **parallel execution**. `all` is parallel; a pure `zip` of already-known thunks can stay sequential composition if you want determinism — name them differently so teams don’t confuse “tuple” with “fan-out.”

---

## How the pieces click together (one story)

```text
execute(program)
  └─ root fiber + root scope
       └─ thunk machine steps (runEffect)
            ├─ run use(X)              → Requires
            ├─ try child               → Fail(E) early return
            ├─ parallel / all / race   → child fibers under current scope
            ├─ acquireRelease          → finalizers on current scope
            ├─ Ref / Queue / Deferred  → shared sync, interruptible waits
            └─ interrupt / timeout     → cooperative cancel + finalizers
```

**Typed error channel** stays `Fail(E)` on the thunk (already shipped).  
**Requirements** stay `Requires`.  
**Async** stays the “may hit the event loop” flag.  
**Concurrency** adds: fibers (runtime), scopes (lifetime protocol), maybe `Uninterruptible` (flag protocol).

You do *not* need a three-parameter `Effect<A,E,R>` type constructor if postfix bags already carry the same information:

```ts
Thunk<User>
  Fail(NotFound | Timeout)
  Requires(Database | Scope)
  Async
```

That *is* the Effect shape, spelled in Thunk.

---

## What should be syntax vs library vs executor law

| Concern | Best home | Why |
|---|---|---|
| `parallel` / `all` / `race` / `scope` / `uninterruptible` / `permit` | **Syntax regions** (or very thin keywords) | brackets + structured lifetimes; hard to misuse |
| `fork` / `join` / `interrupt` / `awaitExit` | Runtime API | power user; still `run`-able thunks |
| `Ref` / `Queue` / `Semaphore` / `Deferred` | Runtime library | values + ops; optional block sugar for brackets |
| Interrupt checks between machine steps | **Executor law** | must be universal or it’s fake |
| Finalizers on every exit | **Executor + Scope** | JS `finally` in thunks is the wrong layer |
| Fail / Requires / Async merge on parallel arms | **Type protocols** | same machinery as `bind` |
| Detached / daemon fibers | Opt-in API, loud name | structured-by-default |
| Distributed durable workflows | Later (brainstorm_1 §7) | fibers ≠ Temporal; don’t conflate |

---

## Pitfalls (Thunk-specific)

1. **Don’t make `fork` the default teaching path.** Structured blocks first; fork is `unsafe`/`advanced` energy.
2. **Don’t overload `try`.** Today `try` means “propagate Error arms.” Cancellation/exit matching wants `awaitExit` / `match` on causes — keep Error-union fallibility separate from fiber exit.
3. **Don’t pretend JS Promises are fibers.** `wrap` + `Async` is interop; interruption of a raw Promise is best-effort unless you pass through Scope-aware adapters.
4. **Machine lowering must know about regions.** `parallel { }` isn’t “desugar to nested thunks in user space” only — the lowerer/oracle need to understand join points for types and for interruptible steps.
5. **Scopes vs layers naming.** Teach: *provide = capabilities*, *scope = lifetimes*. Mixing them into one keyword will hurt.
6. **Linearity can wait.** Start with finalizers + structured join; add “can’t return resource past scope” only if the type system can carry it without wrecking ergonomics.

---

## A minimal “natural” MVP (if this cluster were next)

Not a schedule — a coherence check:

1. **Root scope** on `execute`; `scope { }` / `Requires(Scope)`; `acquireRelease`.
2. **`all` / `race` regions** with fail-fast + interrupt siblings; protocol merge like `bind`.
3. **Interrupt between machine steps**; `timeout` via `race`.
4. **`Ref` + `Deferred` + `Semaphore`** as the sync starter pack.
5. **`fork` / `join`** documented as escape hatches under the same supervisor.

Everything else (STM, actors, fair schedulers, durable fibers) stays later — same filter as before: global invariant first.

---

## Bottom line

Effect’s vocabulary is the *runtime physics*. Thunk’s job is to keep the *programmer physics* as:

```ts
thunk {
  parallel { … }
  scope { … }
  const x = try …
  return …
}
```

Fibers, interruption, and scopes are real — but they show up as **regions, protocols, and executor laws**, not as a second monadic dialect. Sync primitives stay ordinary values you `run` methods on. Parallel composition gets **one blessed spelling** so large codebases don’t invent five fan-out helpers.

If the next deep dive is useful, pick one wedge and sketch a concrete surface + lowering:

- **A.** `scope` + `acquireRelease` + `Requires(Scope)` (closest to existing `provide`)
- **B.** `parallel` / `all` / `race` regions + Fail/Requires/Async merge
- **C.** interruptible `machine` executor + `timeout`
- **D.** `Ref` / `Deferred` library shaped for `run`
